// Every /api/chat/* endpoint, behind one function.
//
// Vercel maps each file under api/ to its own Serverless Function, and the
// Hobby plan allows 12 per deployment. Six separate chat routes alongside the
// three leads dashboards, the webhook and the auth pair came to 15, which fails
// at "Deploying outputs" with no build error to explain it.
//
// The URLs are unchanged: vercel.json rewrites /api/chat/<rest> to this file
// with `path=<rest>`. An explicit rewrite is used rather than a [...catch-all]
// so the routing is visible in config instead of implied by a filename.

const api = require('../lib/chat-api');

const ROUTES = {
  leads: api.leads,
  campaigns: api.campaigns,
  messages: api.messages,
  send: api.send,
  crm: api.crm,
  contacted: api.contacted,
};

module.exports = async function handler(req, res) {
  const raw = req.query?.path;
  const parts = (Array.isArray(raw) ? raw.join('/') : String(raw || ''))
    .split('/')
    .filter(Boolean);

  const [name, waId] = parts;
  const route = ROUTES[name];

  if (!route) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(404).json({ error: 'Unknown chat endpoint' });
  }

  // The handlers read the number off the query, as they did when each endpoint
  // was its own [waId].js file.
  if (waId) req.query.waId = waId;

  return route(req, res);
};
