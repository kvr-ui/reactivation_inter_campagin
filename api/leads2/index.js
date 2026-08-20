// GET    /api/leads2   — every "Get Answers" lead, newest first.
// DELETE /api/leads2   — remove several, body { waIds: [...] }.
//
// The second campaign (MONGO_URL2 → questionbank DB), read by the dashboard
// at /dashboard2. Separate database from /api/leads, same shape of response.

const { collectionHandler } = require('../../lib/leads-api');

module.exports = collectionHandler('questionbank');
