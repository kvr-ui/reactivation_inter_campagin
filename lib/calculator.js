// GET /calc/<waId> — the CA Guru bot's calculator link, one per lead.
//
// The calculator is someone else's site, so the only way to know a lead opened
// it is to send them through here first: the click is recorded on their CA Guru
// row (the chat shows it) and they are redirected on to the calculator. It
// shares api/webhook.js's function (vercel.json rewrites /calc/<waId> to
// /api/webhook?source=calc&w=<waId>) for the Hobby plan's 12-function cap.

const { leadsCollection } = require('./mongo');

const CAMPAIGN = 'caguru';
const DEFAULT_TARGET = 'https://focasleadcalculator.vercel.app/';
const WA_ID = /^[0-9]{6,20}$/;

// Link-preview fetchers open the URL as soon as the message is sent. Those are
// not the lead clicking.
const PREVIEW_BOT = /facebookexternalhit|facebot|whatsapp|bot\b|crawler|spider|preview|slurp/i;

module.exports = async function calculatorClick(req, res) {
  const target = process.env.CALCULATOR_URL || DEFAULT_TARGET;
  const waId = String(req.query?.w || '').replace(/\D/g, '');
  const ua = String(req.headers['user-agent'] || '');

  if (req.method === 'GET' && WA_ID.test(waId) && !PREVIEW_BOT.test(ua)) {
    const now = new Date();
    try {
      const col = await leadsCollection(CAMPAIGN);
      // No upsert: a click on a link we never sent a lead is not a lead.
      const r = await col.updateOne(
        { waId },
        {
          $set: { calcClickedAt: now, calcNew: true },
          $min: { calcFirstClickAt: now },
          $inc: { calcClicks: 1 },
        }
      );
      console.log(`--- calculator click --- ${waId}${r.matchedCount ? '' : ' (no CA Guru lead)'}`);
    } catch (err) {
      // The lead still gets the calculator; only our record of it is lost.
      console.error('--- calculator click write failed ---', err.message);
    }
  }

  // no-store, so a second click reaches us instead of the browser's cache.
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Location', target);
  res.status(302).end();
};
