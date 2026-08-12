// POST /api/webhook  (also reachable as /webhook via the rewrite in vercel.json)
//
// WATI posts every message event here. We log the whole request — the log is
// the only record of traffic we drop — and store the ones that are leads.

const { saveReply } = require('../lib/leads');

// Vercel parses JSON and form bodies for us, but WATI's content-type isn't
// guaranteed, so accept a raw string too.
function asPayload(body) {
  if (!body) return null;
  if (typeof body === 'object') return body;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

module.exports = async function handler(req, res) {
  const time = new Date().toISOString();

  console.log(`[${time}] ${req.method} ${req.url}`);
  console.log('--- headers ---', JSON.stringify(req.headers));
  console.log('--- body ---', typeof req.body === 'string' ? req.body : JSON.stringify(req.body));

  const payload = asPayload(req.body);

  if (payload) {
    try {
      await saveReply(payload);
    } catch (err) {
      // A DB failure must not make WATI think delivery failed — it would retry
      // the same event forever. Log it and still acknowledge.
      console.error('--- mongo write failed ---', err.message);
    }
  }

  // Always 200: WATI treats anything else as a failed delivery.
  res.status(200).json({ status: 'ok', received_at: time });
};
