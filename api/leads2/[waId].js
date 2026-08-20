// DELETE /api/leads2/<waId>  — remove one lead.
// PATCH  /api/leads2/<waId>  — body { contacted: true|false }.

const { itemHandler } = require('../../lib/leads-api');

module.exports = itemHandler('questionbank');
