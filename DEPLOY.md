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
| `SERPAPI_KEY` **or** `GOOGLE_API_KEY` + `GOOGLE_CX` | richer Google results (keyless fallback otherwise) |
| `INDIANKANOON_API_TOKEN` | official Indian Kanoon API (public search otherwise) |
| `MCA_API_TOKEN` / `MCA_API_URL` | MCA registry — directors + financials of unlisted companies (skips otherwise) |
| `PRIVATECIRCLE_EMAIL` / `PRIVATECIRCLE_PASSWORD` | PrivateCircle collector |
| `CIBIL_USERNAME` / `CIBIL_PASSWORD` | CIBIL collector |
| `NEXT_PUBLIC_API_BASE` | hybrid frontend → backend URL (build-time) |
| `CORS_ALLOW_ORIGIN` | backend: restrict to your Pages origin (default `*`) |

## Note on persistence

`data/config.json` (admin edits) lives on the container's local disk and is
**ephemeral** — it resets on redeploy. For durable config across deploys, mount
a volume at `/app/data`, or move config to a database (a small future step).
