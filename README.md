# Reactivation campaign — WATI webhook + leads dashboard

Receives WATI webhooks, stores everyone who taps **LAST ATTEMPT** in MongoDB
Atlas, and serves a dashboard to work through the list.

## Layout

| Path                   | What it is                                              |
| ---------------------- | ------------------------------------------------------- |
| `api/webhook.js`       | `POST /api/webhook` — WATI posts here                   |
| `api/leads/index.js`   | `GET /api/leads`, `DELETE /api/leads` (bulk)            |
| `api/leads/[waId].js`  | `DELETE`/`PATCH /api/leads/<number>`                    |
| `lib/mongo.js`         | Cached Atlas client — one connection per warm container |
| `lib/leads.js`         | All read/write logic, shared by every route             |
| `public/index.html`    | The dashboard (served at `/`)                           |
| `webhook-server.js`    | Local dev server; routes to the same `api/` handlers    |
| `scripts/ensure-indexes.js` | One-off index setup (see below)                    |

## Deploy to Vercel

1. **Set the environment variables** — Project → Settings → Environment
   Variables, for _Production_ **and** _Preview_:

   | Name        | Value                                              |
   | ----------- | -------------------------------------------------- |
   | `MONGO_URL` | the `mongodb+srv://…/reactivation?…` string        |
   | `DB_NAME`   | `reactivation`                                     |

   These never go in the repo — `.env` is gitignored and `.vercelignore`d.

2. **Open Atlas to Vercel.** Atlas → Network Access → add `0.0.0.0/0`.
   Vercel functions have no fixed egress IP, so an IP allowlist will not work.

3. **Deploy.** `vercel --prod`, or connect the Git repo and push.

4. **Create the indexes once**, from your machine, against the same cluster:

   ```
   npm run indexes
   ```

   This used to run on every server boot. In serverless that would mean index
   work on every cold start, so it moved into a script — run it once after the
   first deploy, and again only if the indexes are ever dropped.

5. **Point WATI at the new URL:**

   ```
   https://<your-project>.vercel.app/api/webhook
   ```

   `https://<your-project>.vercel.app/webhook` also works (rewrite in
   `vercel.json`), so an existing `/webhook` configuration keeps working.

6. **Dashboard:** `https://<your-project>.vercel.app/`

## Local development

```
cp .env.example .env    # fill in the real MONGO_URL
npm run dev             # http://localhost:3000
```

`webhook-server.js` imports the same handlers as production, so behaviour
matches. `vercel dev` also works if you prefer the real runtime.

## Maintenance

- `npm run dedupe` — collapse duplicate rows if the unique `waId` index ever
  fails to build.
- Logs: Vercel → Project → Logs. Every webhook body is logged there.

## Note on access

The dashboard and its `DELETE`/`PATCH` endpoints are **public** — anyone with
the URL can read and delete leads. That was a deliberate choice for speed. If
that changes, the options are Vercel's Deployment Protection (Pro) or a small
password gate in front of `api/leads/*`.
# reactivation_inter_campagin
