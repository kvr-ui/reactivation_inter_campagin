// CA Guru's WhatsApp provider (wa.focasedu.online), for the chat UI.
//
// Same two calls as lib/wati.js — getThread and sendSession, same return
// shapes — so lib/chat-api.js can pick a provider per campaign and the UI never
// knows which one it is talking to.
//
// The provider keys threads by conversation, not by number. The webhook hands
// us the conversation_id and we keep it on the lead; for a lead stored without
// one, it is looked up once by phone and saved.

const { leadsCollection } = require('./mongo');
const { WINDOW_MS } = require('./wati');

const base = () =>
  (process.env.WACRM_API_URL || process.env.wacrm_api_url || '').replace(/\/+$/, '');
const token = () =>
  (process.env.WACRM_API_TOKEN || process.env.wacrm_api_token || '').replace(/^Bearer\s+/i, '');

const configured = () => !!(base() && token());

async function wacrm(pathAndQuery, init = {}) {
  const res = await fetch(`${base()}/api/v1${pathAndQuery}`, {
    ...init,
    headers: { Authorization: `Bearer ${token()}`, ...(init.headers || {}) },
  });
  let body = null;
  try { body = await res.json(); } catch { /* an HTML error page, or no body */ }
  return { res, body };
}

// The contact whose number is exactly this one. search is a fuzzy match, so
// the phone is compared again here.
async function conversationByPhone(waId) {
  const { res, body } = await wacrm(`/contacts?search=${encodeURIComponent(waId)}`);
  if (!res.ok) throw new Error(`CA Guru contacts HTTP ${res.status}`);
  const contact = (body?.data || []).find((c) => String(c.phone).replace(/\D/g, '') === waId);
  if (!contact) return null;

  const conv = await wacrm(`/conversations?contact_id=${encodeURIComponent(contact.id)}`);
  if (!conv.res.ok) throw new Error(`CA Guru conversations HTTP ${conv.res.status}`);
  return conv.body?.data?.find((c) => c.contact_id === contact.id)?.id || null;
}

async function conversationFor(waId, campaignKey) {
  const col = await leadsCollection(campaignKey);
  const row = await col.findOne({ waId }, { projection: { conversationId: 1 } });
  if (row?.conversationId) return row.conversationId;

  const id = await conversationByPhone(waId);
  if (id) await col.updateOne({ waId }, { $set: { conversationId: id } });
  return id;
}

// One bubble. A template carries no text of its own, so its name stands in.
function toBubble(m) {
  return {
    id: m.id || m.whatsapp_message_id,
    text: m.content_text || '',
    type: m.content_type === 'template' && m.template_name
      ? `template: ${m.template_name}`
      : m.content_type || 'text',
    owner: m.direction === 'outbound',
    at: m.created_at || null,
    status: m.status || null,
    operator: null,
  };
}

// Newest first from the API, paged by cursor; the UI wants oldest first.
async function getThread(waId, pageSize = 60, campaignKey = 'caguru') {
  const empty = { messages: [], windowClosesAt: null, windowOpen: false };
  const id = await conversationFor(waId, campaignKey);
  if (!id) return empty;

  const messages = [];
  let cursor = null;
  while (messages.length < pageSize) {
    const q = `limit=${Math.min(pageSize - messages.length, 100)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const { res, body } = await wacrm(`/conversations/${encodeURIComponent(id)}/messages?${q}`);
    if (!res.ok) throw new Error(`CA Guru messages HTTP ${res.status}`);
    messages.push(...(body?.data || []).map(toBubble));
    cursor = body?.meta?.next_cursor;
    if (!cursor || !body?.data?.length) break;
  }
  messages.sort((a, b) => new Date(a.at) - new Date(b.at));

  const lastInbound = [...messages].reverse().find((m) => !m.owner);
  const windowClosesAt = lastInbound?.at ? new Date(+new Date(lastInbound.at) + WINDOW_MS) : null;

  return { messages, windowClosesAt, windowOpen: windowClosesAt ? windowClosesAt > new Date() : false };
}

async function sendSession(waId, text) {
  const { res, body } = await wacrm('/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: waId, type: 'text', content_text: text }),
  });
  const info = body?.error?.message || body?.message || (res.ok ? 'sent' : `HTTP ${res.status}`);
  return { ok: res.ok, info };
}

module.exports = { getThread, sendSession, configured };
