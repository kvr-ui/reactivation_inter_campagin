// CA Guru lead capture, off our own WhatsApp provider's webhook
// (wa.focasedu.online, `message.received` events).
//
// The provider's { event, data } envelope is what real traffic carries. The
// Meta Cloud API and Gupshup shapes are still read too, in case the provider's
// forwarding ever changes. Every payload is also kept verbatim in raw_events,
// so a caption that stops matching can be diagnosed from what actually arrived.

const { leadsCollection, campaignCollection } = require('./mongo');
const { campaign, keywordsOf, normalize } = require('./campaigns');
const { isStop } = require('./activity');

const CAMPAIGN = 'caguru';
const RAW = 'raw_events';

const first = (...vals) => vals.find((v) => v !== undefined && v !== null && v !== '');

// Digits only, as every other campaign stores waId — "+91 98765 43210" and
// "919876543210" must be the same lead.
const digits = (v) => (v == null ? '' : String(v).replace(/\D/g, ''));

// One inbound message out of whatever envelope the provider wrapped it in.
// Returns null for status callbacks and our own outbound sends.
function parse(payload) {
  // Our provider — the shape real CA Guru traffic arrives in:
  // { event: 'message.received', data: { wa_id, phone, sender_name, text,
  //   whatsapp_message_id, interactive_reply, ... } }
  // Any other event (sends, delivery statuses) is not a lead.
  if (typeof payload?.event === 'string' && payload.data && typeof payload.data === 'object') {
    if (payload.event !== 'message.received') return null;
    const d = payload.data;
    const reply = d.interactive_reply;
    return {
      phone: digits(first(d.wa_id, d.phone)),
      name: first(d.sender_name, d.contact_name),
      text: first(
        typeof reply === 'string' ? reply : undefined,
        reply?.title,
        reply?.text,
        d.text
      ),
      messageId: first(d.whatsapp_message_id, payload.id),
      conversationId: first(d.conversation_id),
      at: first(d.timestamp, payload.occurred_at),
    };
  }

  // Meta Cloud API: { entry: [{ changes: [{ value: { contacts, messages, statuses } }] }] }
  const value = payload?.entry?.[0]?.changes?.[0]?.value;
  if (value) {
    const msg = value.messages?.[0];
    if (!msg) return null; // a delivery/read status, not a message
    return {
      phone: digits(msg.from),
      name: first(value.contacts?.[0]?.profile?.name),
      text: first(
        msg.button?.text, // quick reply on a template
        msg.interactive?.button_reply?.title,
        msg.interactive?.list_reply?.title,
        msg.text?.body
      ),
      messageId: first(msg.id),
    };
  }

  // Gupshup-style: { type: 'message', payload: { payload: { text }, sender: { phone, name } } }
  const inner = payload?.payload;
  if (inner && typeof inner === 'object' && (inner.sender || inner.source)) {
    return {
      phone: digits(first(inner.sender?.phone, inner.source)),
      name: first(inner.sender?.name),
      text: first(inner.payload?.title, inner.payload?.text, inner.text),
      messageId: first(inner.id, payload.id),
    };
  }

  // Flat, WATI-like. owner/direction mark our own sends.
  if (payload?.owner === true) return null;
  if (/^out/i.test(String(payload?.direction || ''))) return null;
  if (payload?.eventType && payload.eventType !== 'message') return null;

  return {
    phone: digits(
      first(payload?.waId, payload?.wa_id, payload?.from, payload?.phone, payload?.mobile,
        payload?.sender?.phone, payload?.sender, payload?.contact?.phone)
    ),
    name: first(payload?.senderName, payload?.name, payload?.profileName, payload?.sender?.name,
      payload?.contact?.name),
    text: first(
      payload?.buttonReply?.text,
      payload?.button?.text,
      payload?.interactiveButtonReply?.text,
      payload?.listReply?.text,
      typeof payload?.text === 'object' ? payload.text?.body : payload?.text,
      payload?.message?.text,
      typeof payload?.message === 'string' ? payload.message : undefined,
      payload?.body
    ),
    messageId: first(payload?.whatsappMessageId, payload?.messageId, payload?.id),
  };
}

// The raw payload, whatever it is. Never throws into the caller's path —
// losing the audit copy must not lose the lead.
async function keepRaw(payload, headers) {
  try {
    const col = await campaignCollection(CAMPAIGN, RAW);
    await col.insertOne({ at: new Date(), headers, payload });
  } catch (err) {
    console.error('--- caguru raw_events write failed ---', err.message);
  }
}

// Same row shape and upsert as lib/leads.js saveReply, so /api/leads4 and the
// dashboard need nothing special.
async function saveCaguruReply(payload) {
  const msg = parse(payload);
  if (!msg || !msg.phone || !msg.text) return { stored: false, reason: 'not an inbound message', msg };

  const c = campaign(CAMPAIGN);
  const wanted = normalize(msg.text);
  if (!keywordsOf(c).some((k) => normalize(k) === wanted)) {
    return { stored: false, reason: `caption "${msg.text}" is not ${c.keyword}`, msg };
  }

  const replies = await leadsCollection(CAMPAIGN);
  const now = new Date();

  try {
    const result = await replies.updateOne(
      { waId: msg.phone },
      {
        $setOnInsert: { buttonReply: c.keyword, receivedAt: now },
        $set: {
          senderName: msg.name ?? null,
          whatsappMessageId: msg.messageId ?? null,
          lastReplyAt: now,
          // The chat reads the thread by conversation, not by number.
          ...(msg.conversationId ? { conversationId: msg.conversationId } : {}),
        },
        $inc: { replyCount: 1 },
      },
      { upsert: true }
    );
    return { stored: true, isNew: Boolean(result.upsertedId), msg };
  } catch (err) {
    // Two deliveries of the same new lead racing; the other one stored it.
    if (err.code === 11000) return { stored: true, isNew: false, msg };
    throw err;
  }
}

// The chat's preview, unread badge, 24h window and STOP column, from any
// message the lead sends — lib/activity.js does the same for WATI. Only
// annotates a lead that already exists: most traffic on this number is the
// CA Guru bot's, not this campaign's.
async function recordCaguruMessage(payload) {
  const msg = parse(payload);
  if (!msg || !msg.phone || !msg.text) return false;

  const at = msg.at && !Number.isNaN(+new Date(msg.at)) ? new Date(msg.at) : new Date();
  const set = {
    lastMsgAt: at,
    lastMsgText: String(msg.text).replace(/\s+/g, ' ').slice(0, 300),
    lastMsgFrom: 'lead',
    lastInboundAt: at,
    ...(msg.conversationId ? { conversationId: msg.conversationId } : {}),
  };
  if (isStop(msg.text)) {
    set.stopped = true;
    set.stoppedAt = at;
  }

  const col = await leadsCollection(CAMPAIGN);
  const r = await col.updateOne({ waId: msg.phone }, { $set: set, $inc: { unread: 1 } });
  return r.matchedCount > 0;
}

module.exports = { parse, keepRaw, saveCaguruReply, recordCaguruMessage };
