# WATI webhook + leads dashboards

Receives WATI webhooks, and stores each lead in the database belonging to the
campaign whose button they tapped. One dashboard per campaign.

## The three campaigns

| Campaign      | Button caption (the keyword) | Database        | Env vars               | API           | Dashboard     |
| ------------- | ---------------------------- | --------------- | ---------------------- | ------------- | ------------- |
| Reactivation  | **LAST ATTEMPT**             | `reactivation`  | `MONGO_URL`, `DB_NAME` | `/api/leads`  | `/`           |
| Question bank | **Get answer**               | `questionbank`  | `MONGO_URL2`, `DB_NAME2` | `/api/leads2` | `/dashboard2` |
| Jan 2027      | **JAN 2027**                 | `jan2027`       | `MONGO_URL3`, `DB_NAME3` | `/api/leads3` | `/dashboard3` |

All campaigns share **one** webhook URL. `api/webhook.js` reads the button
caption off every inbound message and looks it up in
[`lib/campaigns.js`](lib/campaigns.js): a caption matching a campaign's keyword
is stored in that campaign's database, and anything else is dropped. Matching
ignores case and extra spacing, so `get answer` and `Get answer` both count. A
campaign may also list `aliases` — the question bank accepts the plural
"Get Answers" as well as the "Get answer" its template actually sends, and
Jan 2027 also accepts "JANUARY 2027" and "JAN2027".

Nothing in WATI needs to change — every campaign posts to the same URL as the
first.

### Adding a fourth campaign

1. Add an entry to `CAMPAIGNS` in [`lib/campaigns.js`](lib/campaigns.js)
   (keyword + the env var names for its connection string).
2. Add `api/leads4/index.js` and `api/leads4/[waId].js`, each one line, binding
   the new key to the factories in `lib/leads-api.js`.
3. Copy `public/dashboard3.html`, point its four `fetch` calls at the new API,
   and add the tab to the `.nav` block of every dashboard.
4. Add the rewrite in `vercel.json`, the route in `webhook-server.js`'s
   `LEAD_ROUTES`, and the env vars in Vercel.

## Layout

| Path                        | What it is                                                     |
| --------------------------- | -------------------------------------------------------------- |
| `api/webhook.js`            | `POST /api/webhook` — WATI posts here, for **every** campaign   |
| `api/leads/*`               | Campaign 1 endpoints                                            |
| `api/leads2/*`              | Campaign 2 endpoints                                            |
| `api/leads3/*`              | Campaign 3 endpoints                                            |
| `lib/campaigns.js`          | The keyword → database table; the one place campaigns are defined |
| `lib/mongo.js`              | Cached Atlas client **per campaign**                            |
| `lib/leads.js`              | All read/write logic, shared by every route                     |
| `lib/leads-api.js`          | The leads REST handlers, bound to a campaign by each route      |
| `public/index.html`         | Campaign 1 dashboard (served at `/`)                            |
| `public/dashboard2.html`    | Campaign 2 dashboard (served at `/dashboard2`)                  |
| `public/dashboard3.html`    | Campaign 3 dashboard (served at `/dashboard3`)                  |
| `webhook-server.js`         | Local dev server; routes to the same `api/` handlers            |
| `scripts/ensure-indexes.js` | One-off index setup, for every campaign's database              |

## Deploy to Vercel

1. **Set the environment variables** — Project → Settings → Environment
   Variables, for _Production_ **and** _Preview_:

   | Name         | Value                                        |
   | ------------ | -------------------------------------------- |
   | `MONGO_URL`  | the `mongodb+srv://…/reactivation?…` string  |
   | `DB_NAME`    | `reactivation`                               |
   | `MONGO_URL2` | the `mongodb+srv://…/questionbank?…` string  |
   | `DB_NAME2`   | `questionbank`                               |
   | `MONGO_URL3` | the `mongodb+srv://…/jan2027?…` string       |
   | `DB_NAME3`   | `jan2027`                                    |

   These never go in the repo — `.env` is gitignored and `.vercelignore`d.

2. **Open Atlas to Vercel.** Atlas → Network Access → add `0.0.0.0/0`.
   Vercel functions have no fixed egress IP, so an IP allowlist will not work.

3. **Deploy.** `vercel --prod`, or connect the Git repo and push.

4. **Create the indexes once**, from your machine, against the same cluster:

   ```
   npm run indexes
   ```

   This walks every campaign's database. Run it once after the first deploy,
   and again only if the indexes are ever dropped.

5. **Point WATI at the URL** (unchanged — one webhook serves every campaign):

   ```
   https://<your-project>.vercel.app/api/webhook
   ```

   `https://<your-project>.vercel.app/webhook` also works (rewrite in
   `vercel.json`), so an existing `/webhook` configuration keeps working.

6. **Dashboards:** `https://<your-project>.vercel.app/`,
   `/dashboard2` and `/dashboard3`. Each page has a switcher at the top to jump
   to the others.

## Local development

```
cp .env.example .env    # fill in the real MONGO_URL, MONGO_URL2 and MONGO_URL3
npm run dev             # http://localhost:3000, /dashboard2 and /dashboard3
```

`webhook-server.js` imports the same handlers as production, so behaviour
matches. `vercel dev` also works if you prefer the real runtime.

## Maintenance

- `npm run dedupe` — collapse duplicate rows if the unique `waId` index ever
  fails to build.
- Logs: Vercel → Project → Logs. Every webhook body is logged there, and each
  save line names the campaign it landed in, e.g. `--- saved to mongo
  [questionbank] ---`.

## Note on access

The dashboards and their `DELETE`/`PATCH` endpoints are **public** — anyone with
the URL can read and delete leads. That was a deliberate choice for speed. If
that changes, the options are Vercel's Deployment Protection (Pro) or a small
password gate in front of `api/leads*`.
