// Local development server. Production runs on Vercel as the functions under
// api/ — this file exists so you can test against real Mongo without deploying,
// and it routes to the SAME handlers, so the two cannot drift apart.
//
//   node webhook-server.js            -> listens on 3000
//   PORT=8080 node webhook-server.js  -> listens on 8080
//
// (`vercel dev` is the higher-fidelity option; this one needs no CLI or login.)

const http = require('http');
const fs = require('fs');
const path = require('path');

// Node's built-in .env loader (22.x) — keeps the Atlas credentials out of the
// code. On Vercel the same names come from the project's env vars instead.
try {
  process.loadEnvFile(path.join(__dirname, '.env'));
} catch {
  // No .env file: fall back to whatever is already in the environment.
}

const PORT = process.env.PORT || 3000;
// The dashboards, at the same paths the Vercel rewrites serve them from.
const DASHBOARDS = {
  '/': path.join(__dirname, 'public', 'index.html'),
  '/dashboard': path.join(__dirname, 'public', 'index.html'),
  '/dashboard2': path.join(__dirname, 'public', 'dashboard2.html'),
  '/dashboard3': path.join(__dirname, 'public', 'dashboard3.html'),
  '/caguru': path.join(__dirname, 'public', 'caguru.html'),
  '/chat': path.join(__dirname, 'public', 'chat.html'),
};

const webhook = require('./api/webhook');
const chat = require('./api/chat');

// One entry per campaign, mirroring the api/ folders Vercel routes by name:
// campaign 1 is /api/leads, campaign 2 /api/leads2, campaign 3 /api/leads3,
// CA Guru /api/leads4.
const LEAD_ROUTES = {
  leads: { index: require('./api/leads/index'), item: require('./api/leads/[waId]') },
  leads2: { index: require('./api/leads2/index'), item: require('./api/leads2/[waId]') },
  leads3: { index: require('./api/leads3/index'), item: require('./api/leads3/[waId]') },
  // One file for both, as vercel.json routes it: /api/leads4/<waId> → ?waId=.
  leads4: { index: require('./api/leads4'), item: require('./api/leads4') },
};

const LEAD_PATH = /^\/api\/(leads[234]?)(?:\/([^/]+))?$/;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// Vercel hands its handlers a req/res pair with a few extras (req.body already
// parsed, req.query, res.status/.json). Add them so the same handler code runs
// unmodified here.
function adapt(req, res, raw, query) {
  req.query = query;
  req.body = raw;
  if (raw && (req.headers['content-type'] || '').includes('application/json')) {
    try {
      req.body = JSON.parse(raw);
    } catch {
      // Leave it as the raw string; the handlers accept both.
    }
  }

  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(body));
    return res;
  };
  res.send = (body) => {
    res.end(String(body));
    return res;
  };
  return [req, res];
}

const server = http.createServer(async (req, res) => {
  const pathname = req.url.split('?')[0];

  // There is no password gate here (middleware.js only runs on Vercel), and a
  // tunnel like ngrok makes this server public. Through one, only the webhooks
  // are reachable — never the dashboards, or the chat, which can send messages.
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(req.headers.host || '');
  if (!local && !/^\/(api\/)?webhook(\/caguru)?$/.test(pathname)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Only the webhooks are reachable from outside this machine' }));
    return;
  }

  try {
    // Read per request so edits to the HTML show up without a restart.
    if (req.method === 'GET' && DASHBOARDS[pathname]) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(DASHBOARDS[pathname]));
      return;
    }

    const raw = await readBody(req);
    const match = pathname.match(LEAD_PATH);

    if (match) {
      const [, route, waId] = match;
      // With a trailing segment it's one lead, without it the collection.
      const handler = waId ? LEAD_ROUTES[route].item : LEAD_ROUTES[route].index;
      return handler(...adapt(req, res, raw, waId ? { waId } : {}));
    }

    // Every /api/chat/* endpoint, dispatched as vercel.json's rewrite does.
    if (pathname.startsWith('/api/chat/')) {
      const query = Object.fromEntries(new URL(req.url, 'http://x').searchParams);
      return chat(...adapt(req, res, raw, { ...query, path: pathname.slice('/api/chat/'.length) }));
    }

    // CA Guru's provider, tagged the way vercel.json's rewrite tags it.
    if (pathname === '/webhook/caguru') {
      const query = Object.fromEntries(new URL(req.url, 'http://x').searchParams);
      return webhook(...adapt(req, res, raw, { ...query, source: 'caguru' }));
    }

    // Everything else is webhook traffic — some providers verify with a GET.
    return webhook(...adapt(req, res, raw, {}));
  } catch (err) {
    console.error(`--- ${req.method} ${pathname} failed ---`, err.message);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  }
});

server.listen(PORT, () => {
  console.log(`Local server listening on http://localhost:${PORT}`);
  console.log(`Webhook URL: http://localhost:${PORT}/api/webhook`);
  console.log(`Dashboard 1: http://localhost:${PORT}/            (LAST ATTEMPT)`);
  console.log(`Dashboard 2: http://localhost:${PORT}/dashboard2  (Get answer)`);
  console.log(`Dashboard 3: http://localhost:${PORT}/dashboard3  (JAN 2027)`);
  console.log(`CA Guru:     http://localhost:${PORT}/caguru      (webhook: /webhook/caguru)`);
  console.log(`Chat:        http://localhost:${PORT}/chat`);
});
