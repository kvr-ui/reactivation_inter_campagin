// POST /api/login  { password }  -> sets the session cookie.

const auth = require('../lib/auth');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!auth.enabled()) {
    return res.status(500).json({ error: 'APP_PASSWORD is not set on the server' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};

  if (!(await auth.checkPassword(body.password))) {
    // A small delay blunts online guessing; there is no shared store to do
    // proper rate limiting in, and the password is the only secret.
    await new Promise((r) => setTimeout(r, 700));
    return res.status(401).json({ error: 'Wrong password' });
  }

  res.setHeader('Set-Cookie', auth.setCookie(await auth.makeToken()));
  return res.status(200).json({ ok: true });
};
