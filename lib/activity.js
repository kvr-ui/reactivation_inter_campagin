// Conversation activity, recorded straight off the webhook.
//
// WATI posts every message here — inbound and outbound, for every contact —
// and until now everything that wasn't a campaign button tap was discarded.
// Recording the rest gives the chat UI three things it otherwise cannot get:
//
//   * a reply that is ordinary text, not a button tap. lastReplyAt only ever
//     moved on a tap, so a lead who typed "yes" looked idle.
//   * an unread count, without polling WATI once per lead.
//   * the 24-hour window, measured from the lead's real last inbound message.
//
// Everything here is additive: new fields on the existing lead document, wide
// of anything saveReply writes. A failure must never fail the webhook, so the
// caller swallows errors — a missed preview is not worth a WATI retry storm.

const { leadsCollection } = require('./mongo');
const { CAMPAIGNS } = require('./campaigns');

// Whatever WATI used for this message type, flattened to something previewable.
function previewOf(payload) {
  const text =
    payload?.text ||
    payload?.buttonReply?.text ||
    payload?.interactiveButtonReply?.text ||
    payload?.listReply?.text ||
    null;

  if (text) return String(text).replace(/\s+/g, ' ').slice(0, 300);
  return payload?.type ? `[${payload.type}]` : null;
}

function timeOf(payload) {
  const t = payload?.timestamp ?? payload?.created;
  if (!t) return new Date();
  // WATI sends epoch seconds on some events and an ISO string on others.
  if (typeof t === 'number') return new Date(t < 1e12 ? t * 1000 : t);
  const asNum = Number(t);
  if (!Number.isNaN(asNum) && String(t).trim() !== '') {
    return new Date(asNum < 1e12 ? asNum * 1000 : asNum);
  }
  const d = new Date(t);
  return Number.isNaN(+d) ? new Date() : d;
}

// The lead may be in any campaign — or none, which is the common case, since
// most traffic on this number has nothing to do with these campaigns.
async function recordMessage(payload) {
  if (payload?.eventType && payload.eventType !== 'message') return 0;

  const waId = payload?.waId;
  if (!waId) return 0;

  const preview = previewOf(payload);
  if (!preview) return 0;

  const outbound = payload.owner === true;
  const at = timeOf(payload);

  const set = {
    lastMsgAt: at,
    lastMsgText: preview,
    lastMsgFrom: outbound ? 'us' : 'lead',
  };

  // Only a message from the lead opens the 24h window or counts as unread.
  const update = outbound
    ? { $set: set }
    : { $set: { ...set, lastInboundAt: at }, $inc: { unread: 1 } };

  let touched = 0;

  await Promise.all(
    Object.keys(CAMPAIGNS).map(async (key) => {
      const col = await leadsCollection(key);
      // No upsert: a message from someone who is not a lead is not a lead.
      const r = await col.updateOne({ waId }, update);
      if (r.matchedCount) touched++;
    })
  );

  return touched;
}

// Opening the conversation is what clears the badge.
async function markRead(waId, campaignKey) {
  const col = await leadsCollection(campaignKey);
  await col.updateOne({ waId }, { $set: { unread: 0, readAt: new Date() } });
}

module.exports = { recordMessage, markRead, previewOf, timeOf };
