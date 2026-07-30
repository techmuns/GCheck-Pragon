# Deploying Paragon

## ⚠️ This app needs a Node server — not a static host or edge platform

It will **not** run on Cloudflare Pages/Workers, Vercel Edge, or any static
host. Three hard requirements:

- **Playwright + Chromium** for the PrivateCircle / CIBIL collectors (needs a
  full OS, not an edge isolate)
- **Filesystem + in-memory state** — config is written to `data/config.json`
  and runs are held in memory, so it needs one persistent Node process
- **Long-running background jobs** — the research workflow runs after the
  request returns

Deploy it as a **container**, on a **Node VM**, or **hybrid** (static UI on
Cloudflare Pages + backend on a Node host).

---

## Hybrid — Cloudflare Pages (UI) + Node backend

Use this to serve the UI from Cloudflare while the engine runs on a real Node
host. Two deploys from this one repo.

### 1. Backend (the engine) — Render / Railway / Fly / container

Deploy the app normally (Option A or B below). Note its public URL, e.g.
`https://paragon-api.onrender.com`. Set `CORS_ALLOW_ORIGIN` to your Pages URL
(or leave `*`).

### 2. Frontend (static UI) — Cloudflare Pages

In the Cloudflare Pages project settings:

| Setting | Value |
|---|---|
| Build command | `npm run build:static` |
| Build output directory | `out` |
| Environment variable | `NEXT_PUBLIC_API_BASE` = your backend URL |

`build:static` produces a static export of the UI (API routes are excluded —
they live on the backend) with the backend URL baked in. The **build command is
the piece Cloudflare was missing** — that's why the earlier deploy showed raw
files.

> The browser collectors (PrivateCircle / CIBIL) run on the **backend**, not on
> Cloudflare — this split keeps them working.

---

## Option A — Container (recommended)

A `Dockerfile` is included, based on the official Playwright image (Chromium
pre-installed and version-matched).

```bash
docker build -t paragon .
docker run -p 3000:3000 --env-file .env.local paragon
```

Works as-is on **Railway**, **Render**, **Fly.io**, Google Cloud Run, AWS App
Runner, or any container host — point it at the repo / image and expose port
`3000`.

- **Render / Railway:** create a service from the repo, choose "Docker", set the
  env vars below. No build command needed beyond the Dockerfile.
- **Fly.io:** `fly launch` (it detects the Dockerfile), then `fly deploy`.

## Option B — Node VM

```bash
npm ci
npx playwright install --with-deps chromium
npm run build
npm start            # serves on :3000 (respects PORT)
```

Run it under a process manager (pm2, systemd) so it stays up.

## Environment variables

All optional — every source degrades honestly if its key/login is absent.

| Var | Enables |
|-----|---------|
| `OPENAI_API_KEY` | AI-written brief (rules-based fallback without it) |
| `OPENAI_MODEL` | model override (default `gpt-4o-mini`) |
| `MUNSHOT_TOKEN` | Munshot web search, the news deep dive, **and** the article reader. **Expires** — see the note below |
| `FIRECRAWL_API_KEY` | fallback article reader, for publishers Muns can't open and for when the Munshot token expires |
| `SERPAPI_KEY` **or** `GOOGLE_API_KEY` + `GOOGLE_CX` | richer Google results, and the news sweep's fallback engine (keyless fallback for web only) |
| `INDIANKANOON_API_TOKEN` | official Indian Kanoon API (public search otherwise) |
| `MAX_ARTICLE_READS` | how many articles one run may open — each is a reader call + an OpenAI call (default 8) |
| `MAX_NEWS_QUERIES` | cap on the news ladder (default 24) |
| `SOURCE_DEADLINE_SECONDS` | how long one source may take before the run goes on without it (default 240) |
| `PRIVATECIRCLE_EMAIL` / `PRIVATECIRCLE_PASSWORD` | PrivateCircle collector |
| `CIBIL_USERNAME` / `CIBIL_PASSWORD` | CIBIL collector |
| `NEXT_PUBLIC_API_BASE` | hybrid frontend → backend URL (build-time) |
| `CORS_ALLOW_ORIGIN` | backend: restrict to your Pages origin (default `*`) |

> **Never prefix any of these with `NEXT_PUBLIC_`.** That prefix tells Next to
> inline the value into the JavaScript bundle every visitor downloads. It is
> correct for `NEXT_PUBLIC_API_BASE` (a public URL) and catastrophic for a
> credential: `NEXT_PUBLIC_MUNSHOT_TOKEN` would publish your Munshot session to
> anyone who opens devtools. Every key above is read **server-side only**, in
> `lib/collectors/env.ts`, and must stay that way.

### Where each kind of secret actually goes

A common and costly mix-up, because all three places are called "secrets":

| Store | Reaches | Use it for |
|---|---|---|
| **GitHub → Settings → Secrets** | GitHub Actions runners only | deploy tokens for a workflow. **Not** the running app — nothing here is visible to the server at request time |
| **Cloudflare Pages → Variables** | the Pages *build*, and Pages Functions at runtime | `NEXT_PUBLIC_API_BASE` (build-time). This repo ships no Functions, so a runtime secret here has nothing to read it |
| **Your Node host** (Render/Railway/Fly/container) | the running server process | **everything in the table above** — this is the only place they do anything |

## Note on persistence

`data/config.json` (admin edits) lives on the container's local disk and is
**ephemeral** — it resets on redeploy. For durable config across deploys, mount
a volume at `/app/data`, or move config to a database (a small future step).

## Note on `MUNSHOT_TOKEN`

The Munshot APIs (`/tools/web-search`, `/tools/news-search`, `/tools/web-reader`)
authenticate
with `bearer_jwt` — a **user session token**, not a service key. Munshot issues
it to dashboards embedded in its host app at runtime; there is no long-lived
equivalent for a standalone server like this one. A token copied from a browser
session works only until that session expires, at which point search returns
`403 Invalid authentication token`.

Because of that, treat `MUNSHOT_TOKEN` as best-effort and always configure a
durable backend alongside it — `SERPAPI_KEY`, or `GOOGLE_API_KEY` + `GOOGLE_CX`.
The collector walks every configured backend in order and keeps the first that
answers, so an expired Munshot token degrades to Google rather than taking web
search down. News degrades from Munshot to SerpAPI's `google_news` engine; with
neither credential set, the news source is skipped and says so in the brief.

The token now also gates the **article reader**, so its expiry costs more than
it used to: without it, no article is opened, and the brief is written from
headlines alone. That is a real loss of quality — a headline cannot say whether
the subject brought a complaint or answered it — so set `FIRECRAWL_API_KEY` as
the durable fallback if you want reading to survive an expired session. With
neither, the run still completes and states plainly that nothing was opened.

Identity resolution does **not** depend on the token: the MCA registry source is
keyless, and with a DIN it needs a single plain GET. A run with no credentials at
all still resolves who the subject is and reports the register's view of their
standing.

### Monitoring the token

`GET /api/health` reports search-credential status without exposing the token:

```json
{ "ok": true, "status": "degraded",
  "search": { "primary": "munshot", "hasDurableFallback": true },
  "munshotToken": { "state": "expiring", "expiresAt": "...", "hoursRemaining": 11.5 } }
```

It returns **503** only when search is genuinely broken (no valid token *and* no
Google backend), so an uptime checker can alert on the status code alone. States
are `valid`, `expiring` (under 48h left), `expired`, `absent`, and `opaque` (a
token with no readable expiry).

### Search result cache

Search backends are metered (SerpAPI's free tier is 100 calls a **month**, and a
brief costs roughly three per entity), so identical queries reuse a recent
result instead of spending quota twice. Re-running the same company is free.

Every metered lookup goes through it: the web sweep, the news pass, Indian
Kanoon, and exchange filings.

- TTL defaults to **15 minutes**; override with `SEARCH_CACHE_TTL_SECONDS`.
  Short enough that a brief re-run tomorrow reflects tomorrow's news, long
  enough that re-running a subject while you review it costs nothing.
- Two runs of the same subject launched at once share a single request rather
  than both missing the cache — the in-flight call is what's cached, not just
  its result.
- Failures are never cached, so replacing an expired token recovers immediately
  rather than after the TTL lapses.
- The cache is in-memory, so a redeploy or a free-instance spin-down clears it.
- `GET /api/health` reports `search.cache` — `hits` are metered calls not spent.
