// Gates the whole deployment behind the shared password.
//
// Everything is protected except the webhook, the login page and the login
// endpoint. The webhook is excluded because WATI cannot send a cookie and a
// 401 there would stop lead capture without any visible error.

import auth from './lib/auth.js';

export const config = {
  // Vercel's matcher cannot express "not this path", so the exclusions are
  // handled in code below rather than here.
  matcher: '/((?!_next|favicon.ico).*)',
};

const OPEN = new Set(['/login', '/login.html', '/api/login', '/api/logout', '/api/webhook', '/webhook']);

export default async function middleware(request) {
  const url = new URL(request.url);
  const path = url.pathname;

  // No password configured means the gate is off, so a missing env var can
  // never lock the team out of their own tool.
  if (!auth.enabled()) return;
  if (OPEN.has(path)) return;

  const token = auth.readCookie(request.headers.get('cookie'), auth.COOKIE);
  if (await auth.verifyToken(token)) return;

  // An API call should get a clean 401 to react to; a page should get the
  // login screen, with where they were going preserved.
  if (path.startsWith('/api/')) {
    return new Response(JSON.stringify({ error: 'Not signed in' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return Response.redirect(new URL(`/login?next=${encodeURIComponent(path)}`, url.origin), 302);
}
