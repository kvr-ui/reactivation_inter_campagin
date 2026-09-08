// POST /api/logout — drops the session cookie.

const auth = require('../lib/auth');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Set-Cookie', auth.clearCookie());
  return res.status(200).json({ ok: true });
};
