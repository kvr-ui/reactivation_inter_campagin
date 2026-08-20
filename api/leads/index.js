// GET    /api/leads   — every LAST ATTEMPT lead, newest first.
// DELETE /api/leads   — remove several, body { waIds: [...] }.
//
// The reactivation campaign (MONGO_URL → reactivation DB). The second
// campaign's equivalent is api/leads2/index.js.

const { collectionHandler } = require('../../lib/leads-api');

module.exports = collectionHandler('reactivation');
