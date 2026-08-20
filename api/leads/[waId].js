// DELETE /api/leads/<waId>  — remove one lead.
// PATCH  /api/leads/<waId>  — body { contacted: true|false }.

const { itemHandler } = require('../../lib/leads-api');

module.exports = itemHandler('reactivation');
