// Shared-password session auth.
//
// Vercel's own Deployment Protection cannot cover a production domain on the
// Hobby plan — Standard Protection leaves the production URL public, and
// "All Deployments" is Pro-only. This app exposes lead conversations, CRM
// records and a WhatsApp send endpoint, so it needs a gate of its own.
//
// Deliberately NOT gated: /api/webhook. WATI cannot present a cookie, and a
// blocked webhook silently stops lead capture. It stays open exactly as it is
// today — this change does not widen that surface.
//
// Web Crypto rather than node:crypto so the same code runs in Routing
// Middleware and in a serverless function without a second implementation.

const TTL_MS = 30 * 24 * 60 * 60 * 1000;   // 30 days
const COOKIE = 'focas_session';

const b64url = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function sha256(text) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

// Comparing digests rather than raw strings gives constant time and hides the
// length of the submitted password.
function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

const password = () => process.env.APP_PASSWORD || '';
const enabled = () => !!password();

// Derived from the password on purpose: changing the password invalidates every
// existing session, which is what you want when someone leaves.
async function secretKey() {
  const raw = await sha256(`focas-session-v1:${password()}`);
  return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

async function sign(value) {
  const key = await secretKey();
  return b64url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
}

async function checkPassword(input) {
  if (!enabled()) return false;
  return sameBytes(await sha256(String(input ?? '')), await sha256(password()));
}

async function makeToken() {
  const exp = String(Date.now() + TTL_MS);
  return `${exp}.${await sign(exp)}`;
}

async function verifyToken(token) {
  if (!token || typeof token !== 'string') return false;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return false;

  const exp = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;

  const expected = await sign(exp);
  return sameBytes(new TextEncoder().encode(mac), new TextEncoder().encode(expected));
}

function readCookie(header, name) {
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

// Secure is fine to hardcode: Vercel serves every deployment over HTTPS, and
// `vercel dev` is reached over localhost, which browsers treat as secure.
const setCookie = (token) =>
  `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${Math.floor(TTL_MS / 1000)}`;

const clearCookie = () => `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;

module.exports = {
  COOKIE, enabled, checkPassword, makeToken, verifyToken,
  readCookie, setCookie, clearCookie,
};
