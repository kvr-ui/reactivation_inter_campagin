// The /api/chat endpoints, as one dispatcher.
//
// Vercel maps files to routes, so each route file under api/chat binds a
// handler from here — the logic lives once.

const { leadsCollection } = require('./mongo');
const { CAMPAIGNS } = require('./campaigns');
const { markRead } = require('./activity');
const { setContacted } = require('./leads');
const { getThread, sendSession, configured: watiReady, WINDOW_MS } = require('./wati');
const { biginFor, configured: biginReady } = require('./bigin');

const WA_ID = /^[0-9]{6,20}$/;

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
      },
    })
    .toArray();

  const out = rows.map((r) => {
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
    };
  });

  // Unread first, then most recent — the order an inbox is useful in.
  out.sort((a, b) => (b.unread > 0) - (a.unread > 0) || new Date(b.lastAt) - new Date(a.lastAt));
  return res.status(200).json(out);
}

// GET /api/chat/messages/<waId>
async function messages(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const waId = req.query?.waId;
  if (typeof waId !== 'string' || !WA_ID.test(waId)) {
    return res.status(400).json({ error: 'Invalid number' });
  }
  if (!watiReady()) return res.status(500).json({ error: 'WATI is not configured' });

  const out = await getThread(waId, Math.min(Number(req.query.pageSize) || 60, 200));
  // Having the thread on screen is what "read" means.
  if (req.query.read !== '0') {
    await markRead(waId, campaignKey(req)).catch(() => {});
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
  if (!watiReady()) return res.status(500).json({ error: 'WATI is not configured' });

  const text = String(body(req).text || '').trim();
  if (!text) return res.status(400).json({ error: 'Message is empty' });

  const result = await sendSession(waId, text);
  if (!result.ok) return res.status(502).json({ error: result.info });

  console.log(`--- sent to ${waId} --- ${text.slice(0, 60).replace(/\n/g, ' ')}`);
  await markRead(waId, campaignKey(req)).catch(() => {});
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
  return res.status(200).json(Object.values(CAMPAIGNS).map((c) => ({ key: c.key, label: c.label })));
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
};
