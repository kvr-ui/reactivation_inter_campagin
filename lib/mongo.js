// Mongo access for the serverless functions.
//
// On Vercel every request may land in a fresh invocation, but warm containers
// are reused — so the client is cached on globalThis. Reconnecting per request
// would open a new Atlas connection each time and exhaust the cluster's limit.

const { MongoClient } = require('mongodb');

const MONGO_URL = process.env.MONGO_URL || process.env.MONGODBURL;

// Undefined means "use the database named in the connection string" (/reactivation).
const DB_NAME = process.env.DB_NAME || undefined;
const COLLECTION = 'button_replies';

// Survives hot reloads in `vercel dev` and container reuse in production.
const cache = (globalThis.__watiMongo ??= { promise: null });

function connect() {
  if (!MONGO_URL) {
    throw new Error('MONGO_URL is not set (add it in Vercel → Settings → Environment Variables)');
  }

  if (!cache.promise) {
    const client = new MongoClient(MONGO_URL, {
      // A function times out well before Mongo's 30s default would give up, so
      // fail fast and return a real error instead of a dead request.
      serverSelectionTimeoutMS: 5000,
      // Each warm container keeps its own pool; small keeps Atlas headroom.
      maxPoolSize: 5,
    });

    cache.promise = client.connect().catch((err) => {
      // Don't poison the container: a transient Atlas blip must not make every
      // later request in this instance reuse the same rejected promise.
      cache.promise = null;
      throw err;
    });
  }

  return cache.promise;
}

// The one collection everything reads and writes.
async function leadsCollection() {
  const client = await connect();
  return client.db(DB_NAME).collection(COLLECTION);
}

module.exports = { leadsCollection, COLLECTION, DB_NAME };
