// The /api/leads endpoints, as factories.
//
// Each campaign gets its own route folder (api/leads, api/leads2) because
// Vercel maps folders to URLs — but the logic is identical, so it lives here
// once and each route just binds its campaign key. A bug fixed here is fixed
// for every campaign.

const { listLeads, deleteLead, deleteLeads, setContacted, WA_ID } = require('./leads');

// GET    — every lead, newest first.
// DELETE — remove several, body { waIds: [...] }.
function collectionHandler(campaignKey) {
  return async function handler(req, res) {
    // Lead data changes constantly and the dashboard polls every 15s; a cached
    // response would show stale rows.
    res.setHeader('Cache-Control', 'no-store');

    try {
      if (req.method === 'GET') {
        return res.status(200).json(await listLeads(campaignKey));
      }

      if (req.method === 'DELETE') {
        const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};

        const waIds = Array.isArray(body.waIds)
          ? body.waIds.filter((id) => typeof id === 'string' && WA_ID.test(id))
          : [];

        if (!waIds.length) {
          return res.status(400).json({ error: 'waIds must be a non-empty array of numbers' });
        }

        const deleted = await deleteLeads(waIds, campaignKey);
        console.log(`--- deleted ${deleted} lead(s) [${campaignKey}] --- ${waIds.join(', ')}`);
        return res.status(200).json({ deleted });
      }

      res.setHeader('Allow', 'GET, DELETE');
      return res.status(405).json({ error: 'Method not allowed' });
    } catch (err) {
      console.error(`--- leads [${campaignKey}] ${req.method} failed ---`, err.message);
      return res.status(500).json({ error: err.message });
    }
  };
}

// DELETE /<waId>  — remove one lead.
// PATCH  /<waId>  — body { contacted: true|false }.
function itemHandler(campaignKey) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');

    const waId = req.query.waId;

    // Anything that isn't a WhatsApp number is a client bug, not a lead.
    if (typeof waId !== 'string' || !WA_ID.test(waId)) {
      return res.status(400).json({ error: 'Invalid lead number' });
    }

    try {
      if (req.method === 'DELETE') {
        const deleted = await deleteLead(waId, campaignKey);

        if (!deleted) {
          console.log(`--- delete: no such lead [${campaignKey}] --- ${waId}`);
          return res.status(404).json({ error: 'No lead with that number' });
        }

        console.log(`--- deleted lead [${campaignKey}] --- ${waId}`);
        return res.status(200).json({ deleted, waId });
      }

      if (req.method === 'PATCH') {
        const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};

        if (typeof body.contacted !== 'boolean') {
          return res.status(400).json({ error: 'contacted must be true or false' });
        }

        const matched = await setContacted(waId, body.contacted, campaignKey);
        if (!matched) return res.status(404).json({ error: 'No lead with that number' });

        console.log(
          `--- ${waId} marked ${body.contacted ? 'contacted' : 'not contacted'} [${campaignKey}] ---`
        );
        return res.status(200).json({ waId, contacted: body.contacted });
      }

      res.setHeader('Allow', 'DELETE, PATCH');
      return res.status(405).json({ error: 'Method not allowed' });
    } catch (err) {
      console.error(`--- leads [${campaignKey}]/${waId} ${req.method} failed ---`, err.message);
      return res.status(500).json({ error: err.message });
    }
  };
}

module.exports = { collectionHandler, itemHandler };
