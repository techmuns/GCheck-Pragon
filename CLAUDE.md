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
`check:clarifications`, `check:search`, `check:host-token`, `check:firecrawl`,
`check:entity`, `check:judgment`, `check:substance`, `check:related`,
`check:relevance`, `check:golden`, `check:archive`.
`npm run typecheck` and `npm run lint` are both expected to be clean.

## Hard-won rules

Every one of these came from a real failure on a real run. They are written
down because each looked like a small thing and cost a customer's trust.

### Findings

- **A keyword hit is not a finding.** "legal" and "compliance" are ordinary
  corporate words. A run once filed a job posting and a law firm's press
  release about advising the company's funding round under *Key concerns*.
  `lib/relevance.ts` recognises recruitment pages, advisers announcing their
  own mandates, funding rounds and directory listings — and any unambiguous
  adverse word overrules it, because a raise by a company under investigation
  is still a story about the investigation.
- **Losing a real record is worse than showing a near-miss.** Name matching is
  boundary-tolerant: "IndiaMART InterMESH" and "India Mart Intermesh Limited"
  are one company, and so are "Larsen & Toubro" and "Larsen and Toubro". The
  sibling-brand guard still holds — "reliancepower" is nowhere inside
  "reliancedigital".
- **Enrichment may add to a finding, never lose one.** Every read, parse and
  model call is wrapped so a failure leaves the finding exactly as the source
  gave it.

### Reading documents

- **Indian forums share no house style.** A High Court judgment, a consumer
  commission order and a tribunal order agree on nothing — headings, dates,
  case numbers, cause titles all differ. Parse what fits (free, exact), ask the
  model for the rest, and expect a format nobody has seen yet.
- **Every model-supplied fact carries a verbatim quote from the source, checked
  here, or it is dropped.** A model that paraphrases its own evidence has not
  shown the sentence exists.
- **Money is never asked of a model.** Amounts come from the document by regex.
  A hallucinated ₹ figure would be read aloud in a meeting as the exposure.
- **`onlyMainContent` destroys a judgment.** The cause title, CORAM block and
  case number live in page furniture. Scrape the whole page; `judgmentBody()`
  cuts the noise.

### Searching

- **One query is one point of failure.** `site:` is not honoured by every
  backend, and the backend changes. Ladder the query: operator, then no
  operator, then no quotes.
- **An undated query returns this quarter.** A matter from eighteen months ago
  — exactly what a pre-screen is for — never appears unless you sweep year
  windows explicitly.
- **Name the failing route on the artifact itself.** "Could not be opened" with
  no reason cost a full run of debugging. Rows now say which door was shut.

### The report

- **Never show a number that will change.** The score climbed 45 → 80 as
  directors resolved, so what a reader saw depended on when they looked. The
  brief waits until the run is settled.
- **Measure the whole run, not the phase you happen to be in.** Sources
  finishing filled the bar, closed the ring and stopped the clock while board
  screening ran for minutes more — every visual said "done" over working
  software, and customers concluded it had hung.
- **Find where a thing actually renders before fixing it.** Court data had
  three renderers; enriching the collector twice changed nothing on screen
  because the section a reader looks at read from a fourth path.
- **A quiet report must say what it screened and found clear.** Otherwise it
  reads as "not looked at" rather than "looked at and clean".

### Keeping it honest

`npm run check:golden` holds findings-level truths from real analyst
governance checks — the ED/PMLA matter reachable only through a director's
other ventures, the sibling entity in a fund trail, the family board, the side
of an appeal. Unit suites prove the code runs; this proves the product still
finds what matters. **When a miss is found in the wild, add it here** — that is
the ratchet, and it is the only thing that stops a refactor silently losing a
finding.
