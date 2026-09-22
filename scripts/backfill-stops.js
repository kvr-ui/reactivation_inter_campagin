#!/usr/bin/env node
//
// One-off: flag leads who replied STOP before the webhook started recording it.
//
// The webhook sets `stopped` as a STOP arrives, so without this anyone who
// opted out earlier stays in the normal inbox. This reads each lead's recent
// WATI history and sets the same two fields the webhook would have: stopped and
// stoppedAt (the time of their latest STOP).
//
// Safe to re-run. It never creates a lead and never clears a flag.
//
//   node --env-file=.env scripts/backfill-stops.js --all --dry-run
//   node --env-file=.env scripts/backfill-stops.js --all --write
//   node --env-file=.env scripts/backfill-stops.js --campaign jan2027 --write

const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { leadsCollection } = require(path.join(ROOT, 'lib/mongo'));
const { watiCampaigns } = require(path.join(ROOT, 'lib/campaigns'));
const { isStop } = require(path.join(ROOT, 'lib/activity'));

const argv = process.argv.slice(2);
const arg = (n) => { const i = argv.indexOf(n); return i === -1 ? null : argv[i + 1]; };
const has = (n) => argv.includes(n);

const WRITE = has('--write');
const KEYS = has('--all') ? watiCampaigns().map((c) => c.key) : [arg('--campaign') || 'jan2027'];

const BASE = (process.env.WATI_API_ENDPOINT || process.env.WATI_API_URL || '').replace(/\/+$/, '');
const TOKEN = (process.env.WATI_API_TOKEN || process.env.WATI_TOKEN || '').replace(/^Bearer\s+/i, '');

async function pool(items, limit, fn) {
  const it = items[Symbol.iterator]();
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (let n = it.next(); !n.done; n = it.next()) {
      try { await fn(n.value); } catch (e) { console.error('  !', n.value.waId, e.message); }
    }
  }));
}

// WATI returns newest first, so the first inbound STOP is the latest one.
async function latestStop(waId) {
  const res = await fetch(
    `${BASE}/api/v1/getMessages/${encodeURIComponent(waId)}?pageSize=100&pageNumber=0`,
    { headers: { Authorization: `Bearer ${TOKEN}` } }
  );
  if (!res.ok) throw new Error(`WATI HTTP ${res.status}`);
  const items = (await res.json())?.messages?.items || [];
  return items.find((m) => m.eventType === 'message' && m.owner === false && isStop(m.text)) || null;
}

(async () => {
  if (!BASE || !TOKEN) { console.error('WATI_API_ENDPOINT / WATI_API_TOKEN missing'); process.exit(1); }

  for (const key of KEYS) {
    const col = await leadsCollection(key);
    const leads = await col
      .find({ stopped: { $ne: true } }, { projection: { _id: 0, waId: 1, senderName: 1 } })
      .toArray();
    let found = 0;

    console.log(`\n[${key}] checking ${leads.length} leads — ${WRITE ? 'WRITING' : 'dry run'}`);

    await pool(leads, 8, async ({ waId, senderName }) => {
      const stop = await latestStop(waId);
      if (!stop) return;
      found++;
      console.log(`  STOP  ${waId}  ${senderName || ''}`);
      if (WRITE) {
        await col.updateOne(
          { waId },
          { $set: { stopped: true, stoppedAt: new Date(stop.created || stop.timestamp) } }
        );
      }
    });

    console.log(`[${key}] ${found} replied STOP`);
  }

  if (!WRITE) console.log('\nDry run — nothing written. Re-run with --write.');
  process.exit(0);
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
