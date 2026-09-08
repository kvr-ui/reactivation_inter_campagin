#!/usr/bin/env node
//
// One-off: seed lastMsgAt / lastMsgText / lastMsgFrom / lastInboundAt for leads
// that already exist.
//
// The webhook only annotates messages as they arrive, so without this the chat
// list has no previews and no window until each lead happens to message again.
// This reads the newest message per lead straight from WATI (pageSize=1, so the
// payload is tiny) and writes the same fields the webhook would have written.
//
// Safe to re-run. It never creates a lead and never touches saveReply's fields.
// Unread is deliberately left alone: everything here is history you have
// already seen, so seeding a badge would be wrong.
//
//   node --env-file=.env scripts/backfill-activity.js --campaign jan2027 --dry-run
//   node --env-file=.env scripts/backfill-activity.js --campaign jan2027 --write
//   node --env-file=.env scripts/backfill-activity.js --all --write

const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { leadsCollection } = require(path.join(ROOT, 'lib/mongo'));
const { CAMPAIGNS } = require(path.join(ROOT, 'lib/campaigns'));

const argv = process.argv.slice(2);
const arg = (n) => { const i = argv.indexOf(n); return i === -1 ? null : argv[i + 1]; };
const has = (n) => argv.includes(n);

const WRITE = has('--write');
const KEYS = has('--all') ? Object.keys(CAMPAIGNS) : [arg('--campaign') || 'jan2027'];

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

async function newest(waId) {
  const res = await fetch(
    `${BASE}/api/v1/getMessages/${encodeURIComponent(waId)}?pageSize=20&pageNumber=0`,
    { headers: { Authorization: `Bearer ${TOKEN}` } }
  );
  if (!res.ok) throw new Error(`WATI HTTP ${res.status}`);
  const items = ((await res.json())?.messages?.items || []).filter((m) => m.eventType === 'message');
  return {
    last: items[0] || null,
    lastInbound: items.find((m) => m.owner === false) || null,
  };
}

(async () => {
  if (!BASE || !TOKEN) { console.error('WATI_API_ENDPOINT / WATI_API_TOKEN missing'); process.exit(1); }

  for (const key of KEYS) {
    const col = await leadsCollection(key);
    const leads = await col.find({}, { projection: { _id: 0, waId: 1 } }).toArray();
    let seeded = 0, skipped = 0;

    console.log(`\n[${key}] ${leads.length} leads — ${WRITE ? 'WRITING' : 'dry run'}`);

    await pool(leads, 8, async ({ waId }) => {
      const { last, lastInbound } = await newest(waId);
      if (!last) { skipped++; return; }

      const text = last.text || `[${last.type || 'attachment'}]`;
      const set = {
        lastMsgAt: new Date(last.created || last.timestamp),
        lastMsgText: String(text).replace(/\s+/g, ' ').slice(0, 300),
        lastMsgFrom: last.owner === true ? 'us' : 'lead',
      };
      if (lastInbound) set.lastInboundAt = new Date(lastInbound.created || lastInbound.timestamp);

      if (WRITE) await col.updateOne({ waId }, { $set: set });
      seeded++;
    });

    console.log(`[${key}] seeded ${seeded}, no messages for ${skipped}`);
  }

  if (!WRITE) console.log('\nDry run — nothing written. Re-run with --write.');
  process.exit(0);
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
