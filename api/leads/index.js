// GET    /api/leads   — every lead, newest first.
// DELETE /api/leads   — remove several, body { waIds: [...] }.

const { listLeads, deleteLeads, WA_ID } = require('../../lib/leads');

module.exports = async function handler(req, res) {
  // Lead data changes constantly and the dashboard polls every 15s; a cached
  // response would show stale rows.
  res.setHeader('Cache-Control', 'no-store');

  try {
    if (req.method === 'GET') {
      return res.status(200).json(await listLeads());
    }

    if (req.method === 'DELETE') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};

      const waIds = Array.isArray(body.waIds)
        ? body.waIds.filter((id) => typeof id === 'string' && WA_ID.test(id))
        : [];

      if (!waIds.length) {
        return res.status(400).json({ error: 'waIds must be a non-empty array of numbers' });
      }

      const deleted = await deleteLeads(waIds);
      console.log(`--- deleted ${deleted} lead(s) --- ${waIds.join(', ')}`);
      return res.status(200).json({ deleted });
    }

    res.setHeader('Allow', 'GET, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error(`--- /api/leads ${req.method} failed ---`, err.message);
    return res.status(500).json({ error: err.message });
  }
};
