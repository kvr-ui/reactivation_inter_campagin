// DELETE /api/leads/<waId>  — remove one lead.
// PATCH  /api/leads/<waId>  — body { contacted: true|false }.

const { deleteLead, setContacted, WA_ID } = require('../../lib/leads');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const waId = req.query.waId;

  // Anything that isn't a WhatsApp number is a client bug, not a lead.
  if (typeof waId !== 'string' || !WA_ID.test(waId)) {
    return res.status(400).json({ error: 'Invalid lead number' });
  }

  try {
    if (req.method === 'DELETE') {
      const deleted = await deleteLead(waId);

      if (!deleted) {
        console.log(`--- delete: no such lead --- ${waId}`);
        return res.status(404).json({ error: 'No lead with that number' });
      }

      console.log(`--- deleted lead --- ${waId}`);
      return res.status(200).json({ deleted, waId });
    }

    if (req.method === 'PATCH') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};

      if (typeof body.contacted !== 'boolean') {
        return res.status(400).json({ error: 'contacted must be true or false' });
      }

      const matched = await setContacted(waId, body.contacted);
      if (!matched) return res.status(404).json({ error: 'No lead with that number' });

      console.log(`--- ${waId} marked ${body.contacted ? 'contacted' : 'not contacted'} ---`);
      return res.status(200).json({ waId, contacted: body.contacted });
    }

    res.setHeader('Allow', 'DELETE, PATCH');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error(`--- /api/leads/${waId} ${req.method} failed ---`, err.message);
    return res.status(500).json({ error: err.message });
  }
};
