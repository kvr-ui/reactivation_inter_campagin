// Mongo access for the serverless functions.
//
// On Vercel every request may land in a fresh invocation, but warm containers
// are reused — so clients are cached on globalThis. Reconnecting per request
// would open a new Atlas connection each time and exhaust the cluster's limit.
//
// Each campaign has its own connection string (MONGO_URL, MONGO_URL2, …), so
// the cache is keyed by campaign rather than being a single client.

const { MongoClient } = require('mongodb');
const { campaign, DEFAULT_CAMPAIGN } = require('./campaigns');

const COLLECTION = 'button_replies';

// Survives hot reloads in `vercel dev` and container reuse in production.
const cache = (globalThis.__watiMongo ??= { clients: {} });

// MONGODBURL is the name the very first deploy used; still honoured for the
// original campaign so an old Vercel project keeps working.
function urlFor(c) {
  const url = process.env[c.urlEnv] || (c.key === DEFAULT_CAMPAIGN ? process.env.MONGODBURL : '');
  if (!url) {
    throw new Error(
      `${c.urlEnv} is not set (add it in Vercel → Settings → Environment Variables)`
    );
  }
  return url;
}

function connect(c) {
  if (!cache.clients[c.key]) {
    const client = new MongoClient(urlFor(c), {
      // A function times out well before Mongo's 30s default would give up, so
      // fail fast and return a real error instead of a dead request.
      serverSelectionTimeoutMS: 5000,
      // Each warm container keeps its own pool; small keeps Atlas headroom.
      maxPoolSize: 5,
    });

    cache.clients[c.key] = client.connect().catch((err) => {
      // Don't poison the container: a transient Atlas blip must not make every
      // later request in this instance reuse the same rejected promise.
      cache.clients[c.key] = null;
      throw err;
    });
  }

  return cache.clients[c.key];
}

// The one collection each campaign reads and writes. Undefined DB name means
// "use the database named in the connection string".
async function leadsCollection(campaignKey = DEFAULT_CAMPAIGN) {
  const c = campaign(campaignKey);
  const client = await connect(c);
  return client.db(process.env[c.dbEnv] || undefined).collection(COLLECTION);
}

module.exports = { leadsCollection, COLLECTION };
