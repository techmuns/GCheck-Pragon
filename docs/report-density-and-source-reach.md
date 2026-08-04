# Report density & source reach — CESC Ltd diagnosis

Comparing our pre-screen for **CESC Ltd** against a Gemini "Early Governance
Check" of the same company, then explaining why so few of our sources returned
anything — and what was changed to help.

## 1. The density gap

| | Our PreScreen | Gemini report |
|---|---|---|
| Pages | 2 | 9 |
| Words | ~510 | ~2,385 |
| Sources cited | 0 usable | 12 (Tofler, Indian Kanoon ×6, ZaubaCorp ×2, NDTV, CaseMine) |
| Verdict | "No evidence was gathered on CESC Ltd" | Full corporate/financial/litigation analysis |

Gemini's report is ~4.7× the word count, but the real difference is **evidence
gathered**, not prose. Gemini pulled a corporate-parameter table, financials, a
10-row board table (with DINs and appointment dates), and six litigation matters
— all from sources we also target (Tofler, Indian Kanoon). Our run gathered
almost nothing, so there was nothing to be dense *about*.

Two separate problems, then: **(A) we did not reach the sources**, and
**(B) even the parts we do parse were being thrown away before the brief.**

## 2. Why we are not reaching the sources

Our run showed **2 / 9 sources "verified"**, 5 "Not run", 2 "Upgrade". That is
not five independent failures — it is one failure with five faces.

### 2a. Almost every source hangs off a single web-search chain

Web search resolves through one ordered chain
(`lib/collectors/google.ts` → `backendChain()`):

1. **Munshot** web-search — bearer is a *user-session JWT that expires*
2. **SerpAPI** — `SERPAPI_KEY` (`sync: false` in `render.yaml`, so unset)
3. **Google Programmable Search** — `GOOGLE_API_KEY`+`GOOGLE_CX` (also unset)
4. **DuckDuckGo HTML** — keyless, but blocked from datacenter IPs

`registry` (Tofler), `indiafilings`, `news`, `indiankanoon` (web backend) and
`profile` all call `searchWeb()`. When the Munshot JWT has expired and no API
key is configured, the chain falls to DuckDuckGo — which returns a rate-limit
challenge from a server — and every one of those sources fails **together**.
That is the cascade behind "5 sources not run in the same run."

### 2b. The sources that "ran" prove the same point

- **Company Registry (Tofler)** reported *"1 search run — nothing on record."*
  Tofler is not fetched directly — the collector first resolves the company
  **name → Tofler URL via web search**. Search was down, so it never even got a
  URL. Gemini reached the same Tofler page directly by URL and pulled the full
  financials.
- **Wikidata** ran (it is keyless and reachable) but returned nothing — see 2d.

### 2c. Tofler and Indian Kanoon block datacenter IPs directly

Reachability tested from a server-like host:

| Endpoint | Result |
|---|---|
| `tofler.in` company page (direct URL) | **403** |
| `indiankanoon.org` search + `/doc/` | **403** |
| DuckDuckGo HTML | **202** (rate-limit challenge) |
| Munshot web-search (no token) | **403** |
| **Wikidata API** | **200** ✓ |
| IndiaFilings | reachable (server-renders) |

So even with a working search to *find* the Tofler/Indian Kanoon URL, a plain
`fetch()` of those hosts returns **403** from a datacenter. They need to be
fetched through a reader/proxy that is not IP-blocked (the same Munshot/Firecrawl
reader we already use for news articles), or via their official API
(`INDIANKANOON_API_TOKEN`).

### 2d. Wikidata missed CESC on a spelling difference

Wikidata *is* reachable, but the collector searched the literal subject name:

```
wbsearchentities "CESC Ltd"      → NO RESULTS
wbsearchentities "CESC Limited"  → Q3348734  "CESC Limited, electricity supply company in India"
wbsearchentities "CESC"          → a comic writer, two French communes (not the company)
```

The entity is labelled **"CESC Limited"**; a literal search for **"CESC Ltd"**
found nothing, and bare "CESC" resolves to unrelated namesakes. So the one source
that works server-side returned empty on a `Ltd` vs `Limited` mismatch.

## 3. What was changed here

Focused, verifiable fixes that raise reach and density **without** depending on
the metered search backend (which is largely an operational/credential issue):

1. **Wikidata spelling-variant resolution** (`lib/collectors/wikidata.ts`).
   A company is now resolved under spelling variants (`Ltd`↔`Limited`,
   `Pvt`↔`Private`, `&`↔`and`, and a bare-name fallback), preferring a candidate
   whose description reads like an organisation. "CESC Ltd" now resolves to
   Q3348734. Director searches stay literal to avoid namesake drift.

2. **Wikidata company-profile enrichment** (`lib/collectors/wikidata.ts`).
   In company mode the collector now also returns profile facts — founded,
   headquarters, industry, parent group, listing, country, employees, website —
   each cited to the Wikidata entity page. Wikidata is the **one source that
   stays reachable from a datacenter**, so this lets a brief carry a real Company
   Snapshot even on a run where every metered source is dark.

3. **Surface registry master data that was already parsed** (`lib/collectors/indiafilings.ts`).
   `parseCompanyPage` already reads CIN, incorporation date, RoC, authorised /
   paid-up capital, listing status, registered address and last AGM — but company
   mode emitted only the board and discarded all of it. It now emits a
   `company-master` record hit carrying those fields.

4. **Company Snapshot renders a corporate-parameter block** (`lib/assemble.ts`).
   The snapshot merges registry master data (authoritative) with Wikidata profile
   facts (added dimensions the register doesn't publish — HQ, industry, parent,
   website), de-duplicated (Wikidata "Founded" is suppressed when the register
   gave "Incorporated"). Every line is cited; the section fills even when the
   registry host was blocked and only Wikidata answered.

Result for the exact CESC failure run (search down, Wikidata up): the Company
Snapshot goes from **empty** to *CESC Ltd · Founded 1897 · HQ Kolkata · Country
India · Industry · Website*, plus *R. P. Goenka — Founder* under Key People — all
cited. With the registry reachable it becomes the full parameter block
(CIN, incorporation, RoC, capital, listing, address + the Wikidata dimensions).

Covered by `npm run check:snapshot` (offline) and verified live against the
Wikidata API.

## 4. Recommended follow-ups (mostly operational)

The dominant cause of the thin CESC run is **credentials/reachability**, not
brief logic. To actually reach Tofler / Indian Kanoon / news again:

- **Keep a live search credential.** The Munshot bearer is a session JWT that
  expires; set `SERPAPI_KEY` (or `GOOGLE_API_KEY`+`GOOGLE_CX`) alongside it so
  search degrades instead of going dark. `render.yaml` already has the slots —
  they are unset.
- **Fetch IP-blocked hosts through the reader.** Tofler and Indian Kanoon 403 a
  datacenter IP. Route their page fetches through the Munshot/Firecrawl reader
  (already used for articles) or a residential proxy, or set
  `INDIANKANOON_API_TOKEN` for the official API. This is the single change that
  would let us match Gemini's Tofler + Indian Kanoon coverage.
- **Resolve IndiaFilings by CIN directly when it is known.** IndiaFilings
  server-renders and is reachable; `cinUrl(cin)` needs no search. When the
  subject or Wikidata carries a CIN, use it instead of a metered site-search.
- **Set `FIRECRAWL_API_KEY`** so article reading survives a Munshot outage.
