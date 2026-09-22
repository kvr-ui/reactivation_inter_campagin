// GET    /api/leads4         — every CA Guru "YOUR LAST ATTEMPT" lead, newest first.
// DELETE /api/leads4         — remove several, body { waIds: [...] }.
// DELETE /api/leads4/<waId>  — remove one lead.
// PATCH  /api/leads4/<waId>  — body { contacted: true|false }.
//
// The CA Guru campaign (MONGO_URL4 → caguru DB), fed by /webhook/caguru rather
// than WATI and read by the dashboard at /caguru.
//
// One file for both shapes, unlike api/leads3/: vercel.json rewrites
// /api/leads4/<waId> to ?waId=, and each file is a function against the Hobby
// plan's 12-per-deployment cap.

const { collectionHandler, itemHandler } = require('../lib/leads-api');

const collection = collectionHandler('caguru');
const item = itemHandler('caguru');

module.exports = (req, res) => (req.query?.waId ? item(req, res) : collection(req, res));
