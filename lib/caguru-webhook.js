// The CA Guru webhook: POST /webhook/caguru.
//
// Our own WhatsApp provider posts CA Guru traffic here — not WATI. It shares
// api/webhook.js's function (vercel.json rewrites /webhook/caguru to
// /api/webhook?source=caguru) because the Hobby plan caps a deployment at 12
// functions. Every payload is logged and kept in raw_events; taps on the
// campaign's button become leads (see lib/caguru.js).

const { keepRaw, saveCaguruReply, recordCaguruMessage } = require('./caguru');

function asPayload(body) {
  if (!body) return null;
  if (typeof body === 'object') return body;
  try {
    return JSON.parse(body);
  } catch {
    // Form-encoded, from providers that post that way.
    const form = Object.fromEntries(new URLSearchParams(body));
    return Object.keys(form).length ? form : null;
  }
}

module.exports = async function caguruWebhook(req, res) {
  const time = new Date().toISOString();

  // Meta-style verification handshake, which many providers pass through when
  // a webhook URL is first saved: echo the challenge back.
  if (req.method === 'GET') {
    const challenge = req.query?.['hub.challenge'];
    console.log(`[${time}] caguru GET ${req.url}`);
    if (challenge) return res.status(200).send(String(challenge));
    return res.status(200).json({ status: 'ok', webhook: 'caguru' });
  }

  console.log(`[${time}] caguru ${req.method} ${req.url}`);
  console.log('--- caguru body ---', typeof req.body === 'string' ? req.body : JSON.stringify(req.body));

  const payload = asPayload(req.body);

  if (payload) {
    await keepRaw(payload, req.headers);

    try {
      const r = await saveCaguruReply(payload);
      if (r.stored) {
        console.log(`--- caguru lead ${r.isNew ? 'saved' : 'refreshed'} --- ${r.msg.phone} ${r.msg.name ?? ''}`);
      } else {
        console.log(`--- caguru skipped --- ${r.reason}`, JSON.stringify(r.msg ?? null));
      }
    } catch (err) {
      // Acknowledge anyway: a failed delivery would make the provider retry forever.
      console.error('--- caguru mongo write failed ---', err.message);
    }

    // Separate try, as on the WATI side: the chat's preview and unread badge
    // are a nice-to-have next to storing the lead.
    try {
      if (await recordCaguruMessage(payload)) console.log('--- caguru activity recorded ---');
    } catch (err) {
      console.error('--- caguru activity write failed ---', err.message);
    }
  }

  res.status(200).json({ status: 'ok', received_at: time });
};
