// One-off index setup:  node scripts/ensure-indexes.js
//
// The old server did this on every boot. A serverless function boots on every
// cold start, so index work has to move out of the request path — run this once
// after deploying (and again only if the indexes are ever dropped).

const path = require('path');

try {
  process.loadEnvFile(path.join(__dirname, '..', '.env'));
} catch {
  // No .env: use whatever is already in the environment.
}

const { leadsCollection } = require('../lib/mongo');

(async () => {
  const replies = await leadsCollection();
  const existing = await replies.indexes();

  // One row per lead. A lead who taps the button twice must not appear twice,
  // so waId — not whatsappMessageId — is the identity. An earlier build indexed
  // waId non-uniquely; upgrade it in place if that version is present.
  const waIdIndex = existing.find((i) => i.name === 'waId_1');
  if (waIdIndex && !waIdIndex.unique) {
    console.log('upgrading waId index to unique');
    await replies.dropIndex('waId_1');
  }

  try {
    await replies.createIndex({ waId: 1 }, { unique: true });
    console.log('waId unique index ok');
  } catch (err) {
    if (err.code !== 11000) throw err;
    console.error(
      'waId is NOT unique: duplicate rows block the index.\n' +
        'Run `node _dedupe.js` to collapse them, then run this again.'
    );
    process.exitCode = 1;
  }

  // Kept for traceability only — dedupe no longer depends on it, and dropping
  // the unique constraint lets a lead's row record their latest message id.
  const msgIndex = existing.find((i) => i.name === 'whatsappMessageId_1');
  if (msgIndex && msgIndex.unique) {
    await replies.dropIndex('whatsappMessageId_1');
    await replies.createIndex({ whatsappMessageId: 1 }, { sparse: true });
    console.log('whatsappMessageId index relaxed to non-unique');
  }

  process.exit(process.exitCode || 0);
})().catch((err) => {
  console.error('index setup failed:', err.message);
  process.exit(1);
});
