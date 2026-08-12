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
const DASHBOARD = path.join(__dirname, 'public', 'index.html');

const webhook = require('./api/webhook');
const leadsIndex = require('./api/leads/index');
const leadById = require('./api/leads/[waId]');

const LEAD_PATH = /^\/api\/leads\/([^/]+)$/;

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
  return [req, res];
}

const server = http.createServer(async (req, res) => {
  const pathname = req.url.split('?')[0];

  try {
    // Read per request so edits to the HTML show up without a restart.
    if (req.method === 'GET' && (pathname === '/' || pathname === '/dashboard')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(DASHBOARD));
      return;
    }

    const raw = await readBody(req);
    const match = pathname.match(LEAD_PATH);

    if (match) return leadById(...adapt(req, res, raw, { waId: match[1] }));
    if (pathname === '/api/leads') return leadsIndex(...adapt(req, res, raw, {}));

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
  console.log(`Dashboard:   http://localhost:${PORT}/`);
});
