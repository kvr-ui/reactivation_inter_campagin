// The campaigns this deployment handles.
//
// One WATI webhook serves both: api/webhook.js looks at the button caption the
// lead tapped and picks the campaign whose keyword matches. Everything else —
// which Atlas connection to use, which dashboard reads the rows — hangs off
// this table, so adding a third campaign means adding one entry here plus a
// dashboard, not touching the webhook.

const CAMPAIGNS = {
  // The original campaign. Untouched behaviour: same env vars, same database,
  // same /api/leads endpoints, same dashboard at /.
  reactivation: {
    key: 'reactivation',
    keyword: 'LAST ATTEMPT',
    label: 'LAST ATTEMPT',
    urlEnv: 'MONGO_URL',
    dbEnv: 'DB_NAME',
  },

  // The new one. Stored in the separate questionbank database via MONGO_URL2,
  // read by /api/leads2 and the dashboard at /dashboard2.
  //
  // The live WATI template sends "Get answer" (singular). The plural is listed
  // as an alias because the caption was written as "Get Answers" during setup —
  // if the template is ever corrected, leads keep landing either way.
  questionbank: {
    key: 'questionbank',
    keyword: 'Get answer',
    aliases: ['Get Answers'],
    label: 'Get answer',
    urlEnv: 'MONGO_URL2',
    dbEnv: 'DB_NAME2',
  },
};

// Callers that predate the second campaign get the original one.
const DEFAULT_CAMPAIGN = 'reactivation';

function campaign(key = DEFAULT_CAMPAIGN) {
  const found = CAMPAIGNS[key];
  if (!found) throw new Error(`Unknown campaign "${key}"`);
  return found;
}

// WATI's spacing and casing shouldn't decide whether a lead is stored.
function normalize(text) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

// Every caption that routes to a campaign: the keyword plus any aliases. The
// keyword is what gets stored on the row, so the data stays consistent however
// the lead's message was worded.
function keywordsOf(c) {
  return [c.keyword, ...(c.aliases || [])];
}

// Which campaign — if any — owns this button caption. Returns null for the
// hundreds of unrelated captions real traffic carries; those are dropped.
function campaignForReply(buttonReply) {
  const wanted = normalize(buttonReply);
  if (!wanted) return null;
  return (
    Object.values(CAMPAIGNS).find((c) => keywordsOf(c).some((k) => normalize(k) === wanted)) || null
  );
}

module.exports = { CAMPAIGNS, DEFAULT_CAMPAIGN, campaign, campaignForReply, keywordsOf, normalize };
