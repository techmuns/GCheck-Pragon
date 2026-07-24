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

Deploy it as a **container** (recommended) or on a **Node VM**.

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
| `PRIVATECIRCLE_EMAIL` / `PRIVATECIRCLE_PASSWORD` | PrivateCircle collector |
| `CIBIL_USERNAME` / `CIBIL_PASSWORD` | CIBIL collector |

## Note on persistence

`data/config.json` (admin edits) lives on the container's local disk and is
**ephemeral** — it resets on redeploy. For durable config across deploys, mount
a volume at `/app/data`, or move config to a database (a small future step).
