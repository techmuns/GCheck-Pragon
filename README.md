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
| **2 — Retrieval engine** | Real collectors: Google + Indian Kanoon APIs, PrivateCircle + CIBIL via Playwright | pending |
| **3 — Aggregation & AI** | Extract/normalise/dedupe + OpenAI-synthesised brief | pending |
| **4 — Admin panel** | Edit sources, keywords, prompts, section templates | pending |

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
  workflow.ts              # mocked workflow (Phase 2/3 replace this)
```
