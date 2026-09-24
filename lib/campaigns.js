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
    // The 17 Sep 2026 resend captions its button "YOUR LAST ATTEMPT"; without
    // this alias every tap on it was dropped as belonging to no campaign.
    aliases: ['YOUR LAST ATTEMPT'],
    label: 'LAST ATTEMPT',
    urlEnv: 'MONGO_URL',
    dbEnv: 'DB_NAME',
    // The template went out again on 17 Sep 2026. Anyone who taps from then
    // on — new or returning — is listed apart in the chat as LAST ATTEMPT 2,
    // judged by lastReplyAt, which only moves on a button tap.
    secondWave: { from: '2026-09-17T00:00:00+05:30', label: 'LAST ATTEMPT 2' },
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

  // The third one. Leads who tap the "JAN 2027" button — the January 2027
  // intake — land in their own jan2027 database via MONGO_URL3, read by
  // /api/leads3 and the dashboard at /dashboard3.
  //
  // normalize() already absorbs case and spacing, so the aliases only cover
  // captions that differ by more than that: the month spelled out, and the
  // no-space form.
  jan2027: {
    key: 'jan2027',
    keyword: 'JAN 2027',
    aliases: ['JANUARY 2027', 'JAN2027'],
    label: 'JAN 2027',
    urlEnv: 'MONGO_URL3',
    dbEnv: 'DB_NAME3',
  },

  // Leads who tap "START YOUR PREP". No database of its own: it shares the
  // reactivation database (MONGO_URL / DB_NAME) and keeps its leads apart in
  // their own collection. Shown in the chat under the JOINED ELSEWHERE tab.
  prep: {
    key: 'prep',
    keyword: 'START YOUR PREP',
    aliases: [],
    label: 'JOINED ELSEWHERE',
    urlEnv: 'MONGO_URL',
    dbEnv: 'DB_NAME',
    collection: 'start_your_prep',
  },

  // Leads who tap "JOIN NOW". Same arrangement as prep: the reactivation
  // database, its own collection. Shown in the chat under COLD PROLONGING.
  joinnow: {
    key: 'joinnow',
    keyword: 'JOIN NOW',
    aliases: [],
    label: 'COLD PROLONGING',
    urlEnv: 'MONGO_URL',
    dbEnv: 'DB_NAME',
    collection: 'join_now',
  },

  // Leads who tap "REGISTERED WITH ICAI". Same arrangement as prep: the
  // reactivation database, its own collection. Shown in the chat under
  // REGISTERED WITH ICAI.
  icai: {
    key: 'icai',
    keyword: 'REGISTERED WITH ICAI',
    aliases: [],
    label: 'REGISTERED WITH ICAI',
    urlEnv: 'MONGO_URL',
    dbEnv: 'DB_NAME',
    collection: 'registered_with_icai',
  },

  // Leads who tap "YES". Same arrangement as prep: the reactivation database,
  // its own collection. Shown in the chat under YES.
  yes: {
    key: 'yes',
    keyword: 'YES',
    aliases: [],
    label: 'YES',
    urlEnv: 'MONGO_URL',
    dbEnv: 'DB_NAME',
    collection: 'yes_replies',
  },

  // CA Guru. Not a WATI campaign: its leads come from our own provider, which
  // posts to its own webhook (/webhook/caguru → api/webhook-caguru.js). Its
  // button caption is the same "YOUR LAST ATTEMPT" as reactivation's resend,
  // which is exactly why it must never be matched by caption on the WATI
  // webhook — `provider` keeps it out of watiCampaigns() below. Stored in the
  // caguru database via MONGO_URL4, read by /api/leads4 and /caguru.
  caguru: {
    key: 'caguru',
    provider: 'caguru',
    keyword: 'YOUR LAST ATTEMPT',
    aliases: ['LAST ATTEMPT'],
    label: 'CA GURU',
    urlEnv: 'MONGO_URL4',
    dbEnv: 'DB_NAME4',
  },
};

// The campaigns WATI's webhook, activity tracking and the chat serve. The chat
// loads threads and sends through WATI, so a campaign on another provider has
// nothing to show there.
function watiCampaigns() {
  return Object.values(CAMPAIGNS).filter((c) => !c.provider);
}

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
    watiCampaigns().find((c) => keywordsOf(c).some((k) => normalize(k) === wanted)) || null
  );
}

module.exports = {
  CAMPAIGNS,
  DEFAULT_CAMPAIGN,
  campaign,
  campaignForReply,
  keywordsOf,
  normalize,
  watiCampaigns,
};
