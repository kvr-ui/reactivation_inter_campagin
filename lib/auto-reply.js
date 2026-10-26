// Automatic answer to a campaign button tap.
//
// A campaign with an `autoReply` (see lib/campaigns.js) gets that text sent
// back through WATI as a session message the moment its button is tapped. The
// tap itself opened the 24-hour window, so no template is needed. Past the
// campaign's `autoReplyUntil`, if it has one, nothing is sent.
//
// WATI retries a webhook it thinks failed, so each tap is claimed by its
// whatsappMessageId before sending: a replay of the same tap finds it already
// claimed and sends nothing, while a genuine second tap gets the text again.
// Runs after saveReply, so the lead's row always exists to claim on.

const { leadsCollection } = require('./mongo');
const { extractButtonReply } = require('./leads');
const { campaignForReply } = require('./campaigns');
const wati = require('./wati');

async function sendAutoReply(payload) {
  if (payload?.owner === true) return null;
  if (payload?.eventType && payload.eventType !== 'message') return null;

  const waId = payload?.waId;
  const target = campaignForReply(extractButtonReply(payload));
  if (!waId || !target?.autoReply) return null;
  if (target.autoReplyUntil && new Date() > new Date(target.autoReplyUntil)) {
    console.log(`--- auto reply expired [${target.key}] --- ${waId}`);
    return null;
  }

  const tapId = payload?.whatsappMessageId || payload?.id || null;
  const replies = await leadsCollection(target.key);
  const claimed = await replies.updateOne(
    { waId, autoReplyFor: { $ne: tapId } },
    { $set: { autoReplyFor: tapId, autoReplyAt: new Date() } }
  );
  if (!claimed.modifiedCount) {
    console.log(`--- auto reply already sent [${target.key}] --- ${waId}`);
    return null;
  }

  const result = await wati.sendSession(waId, target.autoReply);
  console.log(`--- auto reply [${target.key}] --- ${waId} ${result.ok ? 'sent' : 'FAILED'}: ${result.info}`);

  // Release the claim so a WATI retry gets another go.
  if (!result.ok) {
    await replies.updateOne({ waId, autoReplyFor: tapId }, { $set: { autoReplyFor: null } });
  }
  return result;
}

module.exports = { sendAutoReply };
