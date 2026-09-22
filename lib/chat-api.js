// The /api/chat endpoints, as one dispatcher.
//
// Vercel maps files to routes, so each route file under api/chat binds a
// handler from here — the logic lives once.

const { leadsCollection } = require('./mongo');
const { CAMPAIGNS } = require('./campaigns');
const { markRead } = require('./activity');
const { setContacted } = require('./leads');
const wati = require('./wati');
const wacrm = require('./wacrm');
const { biginFor, configured: biginReady } = require('./bigin');

const { WINDOW_MS } = wati;

const WA_ID = /^[0-9]{6,20}$/;

// Which WhatsApp provider holds a campaign's conversations. WATI unless the
// campaign says otherwise — CA Guru runs on our own provider (lib/wacrm.js).
const PROVIDERS = {
  wati: { name: 'WATI', client: wati },
  caguru: { name: 'CA Guru WhatsApp', client: wacrm },
};
const providerOf = (key) => PROVIDERS[CAMPAIGNS[key].provider || 'wati'];

const campaignKey = (req) => {
  const k = (req.query?.campaign || '').toString();
  return CAMPAIGNS[k] ? k : 'jan2027';
};

const body = (req) =>
  (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {});

// GET /api/chat/leads?campaign=…
async function leads(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const key = campaignKey(req);
  const col = await leadsCollection(key);

  const rows = await col
    .find({}, {
      projection: {
        _id: 0, waId: 1, senderName: 1, receivedAt: 1, lastReplyAt: 1, contacted: 1,
        lastMsgAt: 1, lastMsgText: 1, lastMsgFrom: 1, lastInboundAt: 1, unread: 1,
        stopped: 1, stoppedAt: 1, calcClickedAt: 1, calcClicks: 1, calcNew: 1,
      },
    })
    .toArray();

  const wave2From = CAMPAIGNS[key].secondWave && new Date(CAMPAIGNS[key].secondWave.from);
  const out = rows.map((r) => ({
    ...leadRow(r),
    wave: wave2From && r.lastReplyAt && new Date(r.lastReplyAt) >= wave2From ? 2 : 1,
  }));

  // Unread (or a calculator click not yet seen) first, then most recent — the
  // order an inbox is useful in.
  const fresh = (r) => r.unread > 0 || r.calcNew;
  out.sort((a, b) => fresh(b) - fresh(a) || new Date(b.lastAt) - new Date(a.lastAt));
  return res.status(200).json(out);
}

// GET /api/chat/stopped — every lead who replied STOP, across all campaigns,
// newest STOP first. Each row carries its campaign so the UI can open it there.
async function stopped(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const perCampaign = await Promise.all(
    Object.values(CAMPAIGNS).map(async (c) => {
      const col = await leadsCollection(c.key);
      const rows = await col.find({ stopped: true }, { projection: { _id: 0 } }).toArray();
      return rows.map((r) => ({ ...leadRow(r), campaign: c.key, campaignLabel: c.label }));
    })
  );

  const out = perCampaign.flat();
  out.sort((a, b) => new Date(b.stoppedAt || 0) - new Date(a.stoppedAt || 0));
  return res.status(200).json(out);
}

function leadRow(r) {
  // The webhook's view wins where it has one: lastReplyAt only ever moved on
  // a button tap, so it is stale for a lead who typed an ordinary reply.
  const lastAt = r.lastMsgAt || r.lastReplyAt || r.receivedAt;
  const inbound = r.lastInboundAt || r.lastReplyAt || r.receivedAt;
  return {
    waId: r.waId,
    senderName: r.senderName,
    contacted: r.contacted,
    lastAt,
    lastFrom: r.lastMsgFrom || 'lead',
    lastText: r.lastMsgText || null,
    unread: r.unread || 0,
    windowClosesAt: inbound ? new Date(+new Date(inbound) + WINDOW_MS) : null,
    stopped: r.stopped === true,
    stoppedAt: r.stoppedAt || null,
    // The CA Guru bot's calculator link (lib/calculator.js).
    calcClickedAt: r.calcClickedAt || null,
    calcClicks: r.calcClicks || 0,
    calcNew: r.calcNew === true,
  };
}

// GET /api/chat/messages/<waId>
async function messages(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const waId = req.query?.waId;
  if (typeof waId !== 'string' || !WA_ID.test(waId)) {
    return res.status(400).json({ error: 'Invalid number' });
  }
  const key = campaignKey(req);
  const provider = providerOf(key);
  if (!provider.client.configured()) {
    return res.status(500).json({ error: `${provider.name} is not configured` });
  }

  const out = await provider.client.getThread(waId, Math.min(Number(req.query.pageSize) || 60, 200), key);
  // Having the thread on screen is what "read" means.
  if (req.query.read !== '0') {
    await markRead(waId, key).catch(() => {});
  }
  return res.status(200).json(out);
}

// POST /api/chat/send/<waId>   { text }
async function send(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const waId = req.query?.waId;
  if (typeof waId !== 'string' || !WA_ID.test(waId)) {
    return res.status(400).json({ error: 'Invalid number' });
  }
  const key = campaignKey(req);
  const provider = providerOf(key);
  if (!provider.client.configured()) {
    return res.status(500).json({ error: `${provider.name} is not configured` });
  }

  const text = String(body(req).text || '').trim();
  if (!text) return res.status(400).json({ error: 'Message is empty' });

  const result = await provider.client.sendSession(waId, text);
  if (!result.ok) return res.status(502).json({ error: result.info });

  console.log(`--- sent to ${waId} [${key}] --- ${text.slice(0, 60).replace(/\n/g, ' ')}`);
  await markRead(waId, key).catch(() => {});
  return res.status(200).json({ ok: true });
}

// GET /api/chat/crm/<waId>
async function crm(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const waId = req.query?.waId;
  if (typeof waId !== 'string' || !WA_ID.test(waId)) {
    return res.status(400).json({ error: 'Invalid number' });
  }
  if (!biginReady()) return res.status(200).json({ configured: false });

  try {
    return res.status(200).json({ configured: true, ...(await biginFor(waId)) });
  } catch (err) {
    // A CRM outage must not take the conversation down with it.
    console.error(`--- bigin ${waId} failed ---`, err.message);
    return res.status(200).json({ configured: true, error: err.message });
  }
}

// PATCH /api/chat/contacted/<waId>   { contacted }
async function contacted(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const waId = req.query?.waId;
  if (typeof waId !== 'string' || !WA_ID.test(waId)) {
    return res.status(400).json({ error: 'Invalid number' });
  }
  const want = body(req).contacted;
  if (typeof want !== 'boolean') return res.status(400).json({ error: 'contacted must be true or false' });

  const matched = await setContacted(waId, want, campaignKey(req));
  if (!matched) return res.status(404).json({ error: 'No lead with that number' });
  return res.status(200).json({ waId, contacted: want });
}

// GET /api/chat/campaigns
async function campaigns(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json(Object.values(CAMPAIGNS).map((c) => ({
    key: c.key,
    label: c.label,
    secondWave: c.secondWave || null,
  })));
}

// One wrapper so a thrown error is a 500 with a message, not a dead request.
function guard(fn) {
  return async (req, res) => {
    try {
      return await fn(req, res);
    } catch (err) {
      console.error(`--- chat ${req.url} failed ---`, err.message);
      if (!res.headersSent) return res.status(500).json({ error: err.message });
    }
  };
}

module.exports = {
  leads: guard(leads),
  messages: guard(messages),
  send: guard(send),
  crm: guard(crm),
  contacted: guard(contacted),
  campaigns: guard(campaigns),
  stopped: guard(stopped),
};
