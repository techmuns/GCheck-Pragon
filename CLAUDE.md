# Paragon — working notes

Governance red-flag pre-screen, embedded in the Munshot host as an iframe.

## Deployment

| Piece | Where | Notes |
| --- | --- | --- |
| Backend (the engine) | **Render**, service `paragon` | `https://paragon-nsdx.onrender.com` |
| Health / diagnostics | | `https://paragon-nsdx.onrender.com/api/health` |
| Frontend (optional split) | Cloudflare Pages | only when `NEXT_PUBLIC_API_BASE` points at the backend |

`autoDeploy: true` — a push to `main` rebuilds Render. Check the dashboard shows
the commit you expect before debugging anything else.

`/api/health` is the first stop for any "sources are failing" report. It names
every configured search backend, which are benched by the circuit breaker, why,
and how long until they are re-probed — and it never echoes a token.

## Where secrets actually go

Only the **Render** environment reaches the running server. This has bitten us
more than once:

- **GitHub → Secrets** — GitHub Actions only. Invisible to the app at runtime.
- **Cloudflare Pages → Variables** — the Pages *build* only. This repo ships no
  Pages Functions, so a runtime secret set there has nothing to read it.
- **Render → Environment** — the only place a credential does anything.

Names are read verbatim from `lib/collectors/env.ts`. A variable whose name is
not in that file is silently ignored — `MUNSHOT_KEY`, for instance, is not a
name this project reads; the token belongs in `MUNSHOT_TOKEN`.

## Auth model

The dashboard runs inside the Munshot host and takes its identity from there —
there is no login here, and no token belongs in the bundle.

- `lib/sdk.ts` holds **one** SDK client, created at module load so its message
  listener is up before `host:init` can arrive. `autoReady` stays at its default
  and `ready()` is **never** called by hand — either one races the handshake and
  the dashboard connects to nothing.
- `hooks/useHostContext.ts` is the only way to read host context: `getContext()`
  plus a re-sync on every `sdk.onMessage`.
- The SDK loads as a plain classic `<script>` in `<head>` (`app/layout.tsx`).
  Not `next/script` — `beforeInteractive` emits no script element, only a
  preload and a runtime loader entry, so the global would not exist when
  `lib/sdk.ts` is evaluated.
- Every call to this app's API carries `Authorization: Bearer <host token>`.

`lib/hostToken.ts` carries that token server-side. `MUNSHOT_TOKEN` is a *user
session* JWT and expires, so it is the **fallback**: when the request came from
the host, the live token the host handed the dashboard is used instead. A run
outlives the request that started it, so its token is held by run id and
refreshed by the client's own poll — which is what keeps a 20-minute sweep from
dying on the token it began with.

## Search backends

Chain, best first: `munshot` → `serpapi` → `programmable` → `firecrawl` →
keyless fallback. The keyless engine is blocked from most cloud servers, so it
is not a floor. **Firecrawl is** — the same key that reads article pages also
answers searches.

Keep at least one durable credential set beside `MUNSHOT_TOKEN`, or an expiry
takes every search-backed source down at once (MCA Registry, Google & News and
Profile all run through `searchWeb`, so they fail together and read as three
problems rather than one).

## Checks

`npm test` runs them all. Individually: `check:keywords`, `check:attribution`,
`check:clarifications`, `check:search`, `check:host-token`, `check:firecrawl`.
`npm run typecheck` and `npm run lint` are both expected to be clean.
