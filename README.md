# Paragon — Pre-Meeting Research Agent

An NAI due-diligence / pre-meeting research agent. Enter a company and its
promoters; it runs governance red-flag checks across multiple sources and hands
back a **one-page partner brief** with red flags surfaced up top.

An **input → output** experience — not a dashboard.

## The pipeline

```
User input (+ autocomplete)
   → settle IDENTITY first  ──  MCA register (IndiaFilings, keyless)
        a DIN → the person's name and every company and LLP linked to it
   → generate queries (identity × configurable keywords)
   → multi-source retrieval  ── MCA registry · Google · News · Indian Kanoon (API)
                              └─ PrivateCircle · CIBIL                       (Playwright)
   → open and READ the articles that matter (Muns web-reader → Firecrawl)
        each reduced to: what happened · authority · status · the subject's ROLE
   → extract · normalise · dedupe
   → OpenAI synthesis
   → one-page partner brief (configurable sections, red flags on top)
```

**Identity comes first, and it is not a detail.** Until a name is pinned to a
DIN, every hit is a name match — and `subjectConfidence` will not let a name
match move the verdict, correctly, because three registered directors can share
a name. A run that fails to resolve identity cannot find anything, whatever it
reads. Resolving it first is also what makes the searches worth running: knowing
the person's companies is the difference between searching a name and searching
`"<person>" "<their company>"`, which is where governance stories actually live.

**Headlines are not read as facts.** A title says a matter exists; only the body
says whether the subject brought the complaint or answered it. Articles that
score high enough are opened and reduced to structured findings, and a role the
model cannot support with a verbatim quote from the article is dropped.

Sources, keywords and brief sections are editable in an admin panel. The
narrative prompt is not — it lives in `lib/synthesize.ts` alongside the
guardrails that validate what the model returns.

## Build phases

| Phase | Scope | Status |
|-------|-------|--------|
| **1 — Foundation & Input** | Next.js + Paragon design system, autocomplete input, progress + brief shell, config/run data layer, mocked workflow | ✅ done |
| **2 — Retrieval engine** | Real collectors: Google + Indian Kanoon (keyless out of the box, API-key upgrade), PrivateCircle + CIBIL via Playwright; query generation; honest assembler | ✅ done |
| **3 — Aggregation & AI** | Extract/normalise/dedupe evidence + OpenAI-synthesised brief with validated citations; rules-based fallback | ✅ done |
| **4 — Admin panel** | Edit sources, keywords, sections & the synthesis prompt; persisted to config, live into the next run | ✅ done |

## Credentials

Copy `.env.example` to `.env.local`. **Everything is optional** — a source that
lacks its key/login skips honestly and says so in the run. Out of the box, the
MCA registry, Google/News and Indian Kanoon work keyless; the news deep dive and
the article reader need `MUNSHOT_TOKEN` (or `SERPAPI_KEY` / `FIRECRAWL_API_KEY`),
and PrivateCircle and CIBIL light up once their logins are set.

Two dials govern what a deep run costs: `MAX_NEWS_QUERIES` (default 24) and
`MAX_ARTICLE_READS` (default 8, each one a reader call plus an OpenAI call).

## Checks

```bash
npm run typecheck
npm run lint
npm run check:registry   # parses the LIVE registry pages — no credentials needed
```

`check:registry` is the one part of this pipeline that can be verified without a
credential, so it runs in CI on every push and weekly on a schedule. It asserts
the real parse of a known DIN: the name, the DIN status, the six linked
entities, the struck-off one among them, and a co-director read off a company
page. A fixture would only prove we can still parse the markup as it was the day
the fixture was taken.

For everything else there is `/api/dev/probe` (development only, 404s in
production), which exercises each piece on its own:

```
/api/dev/probe?din=07013291                     # the parsed director record
/api/dev/probe?cin=U72900DL2019PTC358371        # the parsed company record
/api/dev/probe?ladder=07013291                  # the news plan, WITHOUT running it
/api/dev/probe?read=<article-url>               # reader + insight extraction
```

`/print-preview` renders the one-pager against synthetic runs, including a
`read` fixture that reproduces the case this pipeline was rebuilt for.

## Design system

The UI inherits the **Paragon Partners design system** (`DESIGNSYSTEM.md`) — a
compact, Bloomberg-style analytic surface. Colour is signal, never decoration;
soft red is reserved for genuine risk. Data honesty is non-negotiable: missing ≠
zero (honest `n/a`), every claim links to a source, nothing is fabricated.

## Running locally

```bash
npm install
npm run dev      # http://localhost:3000
```

## Project layout

```
app/
  page.tsx                 # input → progress → brief state machine
  admin/                   # config editor — sources, keywords, sections, prompt
  api/research/            # trigger + poll a research run
  api/autocomplete/        # company / promoter suggestions
  api/config/              # read / persist / reset the editable config
components/                 # SearchForm, AutocompleteField, ResearchProgress, BriefView, Toggle
lib/
  types.ts                 # shared domain types
  config.ts                # seed sources / keywords / sections (from the client checklist)
  store.ts                 # file-backed config + in-memory run store
  queries.ts               # generate queries from subject × keywords
  workflow.ts              # runs every enabled collector, then synthesises the brief
  evidence.ts              # extract · normalise · dedupe raw hits -> cited evidence
  synthesize.ts            # OpenAI narrative synthesis with validated citations
  assemble.ts              # deterministic fallback brief (no OpenAI key)
  collectors/
    google.ts              # SerpAPI / Programmable Search / keyless fallback
    indiankanoon.ts        # official API / public search
    privatecircle.ts       # Playwright — directorships
    cibil.ts               # Playwright — defaulter checks
    browser.ts             # shared Playwright launch helper
    env.ts                 # credential/key configuration
```
