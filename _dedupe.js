// One-off: collapse pre-existing duplicate rows so the unique waId index can build.
// Keeps the earliest row per lead and folds the extras into replyCount.
const { MongoClient } = require('mongodb');
process.loadEnvFile(__dirname + '/.env');

(async () => {
  const c = new MongoClient(process.env.MONGO_URL);
  await c.connect();
  const col = c.db(process.env.DB_NAME).collection('button_replies');

  const groups = await col
    .aggregate([
      { $group: { _id: '$waId', ids: { $push: '$_id' }, n: { $sum: 1 } } },
      { $match: { n: { $gt: 1 } } },
    ])
    .toArray();

  for (const g of groups) {
    const docs = await col.find({ waId: g._id }).sort({ receivedAt: 1 }).toArray();
    const keep = docs[0];
    const drop = docs.slice(1);
    console.log(
      `waId ${g._id}: keeping ${keep.receivedAt.toISOString()}, removing ${drop.length} duplicate(s)`
    );
    await col.deleteMany({ _id: { $in: drop.map((d) => d._id) } });
    await col.updateOne({ _id: keep._id }, { $set: { replyCount: docs.length } });
  }

  console.log(groups.length ? 'dedupe done' : 'no duplicates found');
  console.log('remaining docs:', await col.countDocuments());
  await c.close();
})();
