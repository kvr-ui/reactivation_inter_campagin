// Shared lead logic — used by the serverless functions and by the local
// webhook-server.js, so the two can never drift apart.
//
// Every read/write takes a campaign key. The key decides which Atlas database
// the row lives in (see lib/campaigns.js); it defaults to the original
// reactivation campaign so nothing that predates the second one changes.

const { leadsCollection } = require('./mongo');
const {
  DEFAULT_CAMPAIGN,
  campaign,
  campaignForReply,
  normalize,
} = require('./campaigns');

// Kept for callers that still expect the original single-campaign constant.
const TARGET_REPLY = campaign(DEFAULT_CAMPAIGN).keyword;

// WhatsApp numbers as WATI sends them: digits only.
const WA_ID = /^[0-9]{6,20}$/;

// Pulls the reply text out of whichever field WATI used for this button type.
function extractButtonReply(payload) {
  return (
    payload?.buttonReply?.text ||
    payload?.interactiveButtonReply?.text ||
    payload?.listReply?.text ||
    // Quick-reply buttons on a *template* message arrive as an ordinary text
    // message whose body is the button caption — WATI leaves the three
    // structured fields above null and sends type:"text". Real campaign
    // traffic looks like this, so it has to be the fallback.
    payload?.text ||
    null
  );
}

async function saveReply(payload) {
  // Skip our own outbound sends and delivery/read status callbacks; they can
  // carry a `text` field too, and only genuine inbound replies are leads.
  if (payload?.owner === true) return null;
  if (payload?.eventType && payload.eventType !== 'message') return null;

  const waId = payload?.waId;
  const senderName = payload?.senderName ?? null;
  const buttonReply = extractButtonReply(payload);

  // Only inbound button/list replies are worth storing.
  if (!waId || !buttonReply) return null;

  // One webhook serves every campaign: the caption picks which one this lead
  // belongs to. Anything that matches no campaign is dropped.
  const target = campaignForReply(buttonReply);
  if (!target) {
    console.log(`--- skipped, no campaign for --- "${buttonReply}"`);
    return null;
  }

  const replies = await leadsCollection(target.key);
  const now = new Date();

  try {
    // Upsert on waId: a repeat tap (or a webhook replay) refreshes the existing
    // row instead of adding a second one. receivedAt stays the first sighting so
    // the dashboard keeps ordering leads by when they actually came in.
    const result = await replies.updateOne(
      { waId },
      {
        $setOnInsert: {
          buttonReply: target.keyword, // normalized: only exact matches reach here
          receivedAt: now,
        },
        $set: {
          senderName,
          whatsappMessageId: payload?.whatsappMessageId ?? null,
          lastReplyAt: now,
        },
        $inc: { replyCount: 1 },
      },
      { upsert: true }
    );

    if (result.upsertedId) {
      console.log(`--- saved to mongo [${target.key}] --- _id=${result.upsertedId}`);
      console.log(JSON.stringify({ campaign: target.key, waId, senderName, buttonReply }));
      return result.upsertedId;
    }

    console.log(`--- duplicate lead, row refreshed [${target.key}] --- ${waId}`);
    return null;
  } catch (err) {
    if (err.code === 11000) {
      // Two webhooks for the same new lead racing each other; the other won.
      console.log(`--- duplicate lead, already stored [${target.key}] --- ${waId}`);
      return null;
    }
    throw err;
  }
}

async function listLeads(campaignKey = DEFAULT_CAMPAIGN) {
  const replies = await leadsCollection(campaignKey);
  return replies
    .find(
      {},
      {
        projection: { _id: 0, waId: 1, senderName: 1, receivedAt: 1, contacted: 1 },
      }
    )
    .sort({ receivedAt: -1 })
    .toArray();
}

async function deleteLead(waId, campaignKey = DEFAULT_CAMPAIGN) {
  const replies = await leadsCollection(campaignKey);
  const result = await replies.deleteOne({ waId });
  return result.deletedCount;
}

// One deleteMany rather than N round trips, so selecting every row on a long
// list stays a single request.
async function deleteLeads(waIds, campaignKey = DEFAULT_CAMPAIGN) {
  const replies = await leadsCollection(campaignKey);
  const result = await replies.deleteMany({ waId: { $in: waIds } });
  return result.deletedCount;
}

async function setContacted(waId, contacted, campaignKey = DEFAULT_CAMPAIGN) {
  const replies = await leadsCollection(campaignKey);
  const result = await replies.updateOne(
    { waId },
    {
      $set: {
        contacted,
        // Null rather than deleted, so un-ticking is distinguishable from
        // a lead that was never ticked at all.
        contactedAt: contacted ? new Date() : null,
      },
    }
  );
  return result.matchedCount;
}

module.exports = {
  TARGET_REPLY,
  WA_ID,
  normalize,
  extractButtonReply,
  campaignForReply,
  saveReply,
  listLeads,
  deleteLead,
  deleteLeads,
  setContacted,
};
