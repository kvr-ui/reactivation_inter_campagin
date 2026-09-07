// DELETE /api/leads3/<waId>  — remove one lead.
// PATCH  /api/leads3/<waId>  — body { contacted: true|false }.

const { itemHandler } = require('../../lib/leads-api');

module.exports = itemHandler('jan2027');
