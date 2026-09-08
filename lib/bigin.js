// Zoho Bigin lookups: the contact behind a WhatsApp number, plus its pipelines,
// call notes and notes.
//
// Two things about this API cost real time to discover, so they are written
// down rather than rediscovered:
//
//   1. Related-list reads REQUIRE a `fields` parameter. Without it Bigin
//      answers 400 REQUIRED_PARAM_MISSING, which reads exactly like "this
//      contact has nothing attached".
//   2. Completed calls — the ones carrying the rep's notes — are in the
//      `All_Calls` related list. `Calls` holds only open/scheduled calls and
//      comes back 204 for virtually every contact.
//
// The access token is shared through Mongo, not a module variable: Zoho
// rate-limits token refreshes ("You have made too many requests continuously"),
// and on serverless every cold start would otherwise ask for a new one.

const { stateCollection } = require('./mongo');

const REGION = process.env.ZOHO_REGION || 'in';
const ACCOUNTS = `https://accounts.zoho.${REGION}`;
const TOKEN_KEY = 'zoho_token';

const configured = () =>
  !!(process.env.ZOHO_CLIENT_ID && process.env.ZOHO_CLIENT_SECRET && process.env.ZOHO_REFRESH_TOKEN);

// Warm containers reuse this; Mongo is the source of truth across cold ones.
let memo = null;
let refreshing = null;

async function accessToken() {
  const now = Date.now();
  if (memo && memo.expiresAt > now + 60000) return memo;

  const state = await stateCollection();
  const stored = await state.findOne({ _id: TOKEN_KEY });
  if (stored && stored.expiresAt > now + 60000) {
    memo = stored;
    return memo;
  }

  // Collapse concurrent refreshes inside one container.
  if (refreshing) return refreshing;

  refreshing = (async () => {
    const qs = new URLSearchParams({
      refresh_token: process.env.ZOHO_REFRESH_TOKEN,
      client_id: process.env.ZOHO_CLIENT_ID,
      client_secret: process.env.ZOHO_CLIENT_SECRET,
      grant_type: 'refresh_token',
    });

    const res = await fetch(`${ACCOUNTS}/oauth/v2/token?${qs}`, { method: 'POST' });
    const body = await res.json().catch(() => ({}));

    if (!body.access_token) {
      throw new Error(body.error_description || body.error || 'Zoho token refresh failed');
    }

    const token = {
      _id: TOKEN_KEY,
      access_token: body.access_token,
      api_domain: body.api_domain || `https://www.zohoapis.${REGION}`,
      expiresAt: Date.now() + (body.expires_in || 3600) * 1000,
    };

    await state.updateOne({ _id: TOKEN_KEY }, { $set: token }, { upsert: true });
    memo = token;
    return token;
  })().finally(() => { refreshing = null; });

  return refreshing;
}

async function zoho(pathAndQuery) {
  const t = await accessToken();
  const res = await fetch(t.api_domain + pathAndQuery, {
    headers: { Authorization: `Zoho-oauthtoken ${t.access_token}` },
  });

  if (res.status === 204) return [];                 // Bigin's "no rows"
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* non-JSON error page */ }

  if (!res.ok) throw new Error(body?.message || `Bigin HTTP ${res.status}`);
  return body?.data || [];
}

// Verified field names — one Bigin doesn't know fails the whole request.
const FIELDS = {
  Notes: 'Note_Title,Note_Content,Created_Time,Owner',
  All_Calls: 'Subject,Call_Type,Call_Start_Time,Call_Duration,Call_Status,Call_Result,Call_Purpose,Description,Owner',
  Pipelines: 'Deal_Name,Stage,Sub_Pipeline,Amount,Closing_Date,Owner',
};

const SHOW = [
  ['CA_Status', 'CA status'],
  ['Attempt', 'Attempt'],
  ['Assigned_to', 'Assigned to'],
  ['Language', 'Language'],
  ['Lead_Source1', 'Source'],
  ['Referral_date', 'Referral date'],
  ['Other_City', 'City'],
  ['Notess', 'Profile'],
  ['Email', 'Email'],
];

async function biginFor(waId) {
  // Bigin's phone search is fuzzy, so plain digits match a stored +91… too.
  const found = await zoho(`/bigin/v2/Contacts/search?phone=${encodeURIComponent(waId)}`);
  if (!found.length) return { found: false };

  const c = found[0];
  const [notes, calls, pipelines] = await Promise.all(
    Object.entries(FIELDS).map(([rel, f]) =>
      zoho(`/bigin/v2/Contacts/${c.id}/${rel}?fields=${f}`).catch(() => [])
    )
  );

  return {
    found: true,
    // A handful of leads have more than one Bigin contact on the same number;
    // say so rather than silently showing the first.
    duplicates: found.length,
    contact: {
      id: c.id,
      name: c.Full_Name || [c.First_Name, c.Last_Name].filter(Boolean).join(' '),
      phone: c.Phone || c.Mobile || null,
      owner: c.Owner?.name || null,
      fields: SHOW
        .map(([key, label]) => ({ label, value: c[key] }))
        .filter((f) => f.value !== null && f.value !== undefined && f.value !== ''),
    },
    pipelines: pipelines.map((d) => ({
      name: d.Deal_Name, stage: d.Stage, sub: d.Sub_Pipeline,
      amount: d.Amount, closing: d.Closing_Date, owner: d.Owner?.name || null,
    })),
    calls: calls
      .map((x) => ({
        at: x.Call_Start_Time, type: x.Call_Type, duration: x.Call_Duration,
        status: x.Call_Status, result: x.Call_Result, purpose: x.Call_Purpose,
        note: x.Description || null, owner: x.Owner?.name || null,
      }))
      .sort((a, b) => new Date(b.at) - new Date(a.at)),
    notes: notes
      .map((n) => ({
        title: n.Note_Title, text: n.Note_Content,
        at: n.Created_Time, owner: n.Owner?.name || null,
      }))
      .sort((a, b) => new Date(b.at) - new Date(a.at)),
  };
}

module.exports = { biginFor, configured };
