# Paragon — Pre-Meeting Research Agent

An NAI due-diligence / pre-meeting research agent. Enter a company and its
promoters; it runs governance red-flag checks across multiple sources and hands
back a **one-page partner brief** with red flags surfaced up top.

An **input → output** experience — not a dashboard.

## The pipeline

```
User input (+ autocomplete)
   → generate queries (input × configurable keywords)
   → multi-source retrieval  ── Google · Indian Kanoon      (API)
                              └─ PrivateCircle · CIBIL       (Playwright)
   → extract · normalise · dedupe
   → OpenAI synthesis
   → one-page partner brief (configurable sections, red flags on top)
```

Sources, keywords, prompts, and brief sections are all editable in an admin panel.

## Build phases

| Phase | Scope | Status |
|-------|-------|--------|
| **1 — Foundation & Input** | Next.js + Paragon design system, autocomplete input, progress + brief shell, config/run data layer, mocked workflow | ✅ done |
| **2 — Retrieval engine** | Real collectors: Google + Indian Kanoon (keyless out of the box, API-key upgrade), PrivateCircle + CIBIL via Playwright; query generation; honest assembler | ✅ done |
| **3 — Aggregation & AI** | Extract/normalise/dedupe evidence + OpenAI-synthesised brief with validated citations; rules-based fallback | ✅ done |
| **4 — Admin panel** | Edit sources, keywords, prompts, section templates | pending |

## Credentials

Copy `.env.example` to `.env.local`. **Everything is optional** — a source that
lacks its key/login skips honestly and says so in the run. Out of the box,
Google/News and Indian Kanoon work keyless; PrivateCircle and CIBIL light up
once their logins are set.

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
  api/research/            # trigger + poll a research run
  api/autocomplete/        # company / promoter suggestions
components/                 # SearchForm, AutocompleteField, ResearchProgress, BriefView
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
