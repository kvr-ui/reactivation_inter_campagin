// GET    /api/leads3   — every "JAN 2027" lead, newest first.
// DELETE /api/leads3   — remove several, body { waIds: [...] }.
//
// The third campaign (MONGO_URL3 → jan2027 DB), read by the dashboard at
// /dashboard3. Separate database from /api/leads and /api/leads2, same shape
// of response.

const { collectionHandler } = require('../../lib/leads-api');

module.exports = collectionHandler('jan2027');
