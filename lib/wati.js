// WATI reads and writes for the chat UI.
//
// Note the two-field auth naming: this deployment's env has used both
// WATI_API_ENDPOINT/WATI_API_TOKEN and WATI_API_URL/WATI_TOKEN, so both are
// accepted rather than forcing a rename of live configuration.

const WINDOW_MS = 24 * 60 * 60 * 1000;

const base = () =>
  (process.env.WATI_API_ENDPOINT || process.env.WATI_API_URL || '').replace(/\/+$/, '');
const token = () =>
  (process.env.WATI_API_TOKEN || process.env.WATI_ACCESS_TOKEN || process.env.WATI_TOKEN || '')
    .replace(/^Bearer\s+/i, '');

const configured = () => !!(base() && token());

async function wati(pathAndQuery, init = {}) {
  const res = await fetch(base() + pathAndQuery, {
    ...init,
    headers: { Authorization: `Bearer ${token()}`, ...(init.headers || {}) },
  });
  let body = null;
  try { body = await res.json(); } catch { /* some 2xx carry no body */ }
  return { res, body };
}

// WATI returns newest-first; the UI wants oldest-first and only the few fields
// a bubble needs.
async function getThread(waId, pageSize = 60) {
  const { res, body } = await wati(
    `/api/v1/getMessages/${encodeURIComponent(waId)}?pageSize=${pageSize}&pageNumber=0`
  );
  if (!res.ok) throw new Error(`WATI getMessages HTTP ${res.status}`);

  const messages = (body?.messages?.items || body?.items || [])
    .filter((m) => m.eventType === 'message')
    .map((m) => ({
      id: m.id || m.whatsappMessageId || m.localMessageId,
      text: m.text || '',
      type: m.type || 'text',
      owner: m.owner === true,          // WATI's own flag: true when we sent it
      at: m.created || m.timestamp || null,
      status: m.statusString || null,
      operator: m.operatorName || null,
    }))
    .sort((a, b) => new Date(a.at) - new Date(b.at));

  // The window runs from the lead's last inbound message. Deriving it from the
  // live thread beats trusting the database, which only records button taps.
  const lastInbound = [...messages].reverse().find((m) => !m.owner);
  const windowClosesAt = lastInbound?.at ? new Date(+new Date(lastInbound.at) + WINDOW_MS) : null;

  return { messages, windowClosesAt, windowOpen: windowClosesAt ? windowClosesAt > new Date() : false };
}

// v1 sendSessionMessage takes the body as a query parameter, not as JSON.
async function sendSession(waId, text) {
  const { res, body } = await wati(
    `/api/v1/sendSessionMessage/${encodeURIComponent(waId)}?messageText=${encodeURIComponent(text)}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' } }
  );
  // WATI answers 200 with { result: false, info } for business errors such as a
  // closed window, so the HTTP status alone is not the answer.
  const ok = res.ok && body?.result !== false && body?.ok !== false;
  const info = body?.info || body?.message || body?.error || (ok ? 'sent' : `HTTP ${res.status}`);
  return { ok, info };
}

module.exports = { getThread, sendSession, configured, WINDOW_MS };
