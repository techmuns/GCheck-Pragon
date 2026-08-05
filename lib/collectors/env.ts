import { hostToken } from "../hostToken";

// ── Credential / key configuration ─────────────────────────────────────────
// All source credentials come from environment variables. Nothing is committed.
// A missing value simply means that source (or its richer mode) stays off, and
// the collector reports that honestly.
//
// The one exception is the Munshot session token. It is a *user* session JWT
// and expires, so the environment copy is the fallback rather than the source:
// when the request came from the Munshot host, the live token the host handed
// the dashboard is used instead. See lib/hostToken.ts.

export const env = {
  // Google / web search backends, in priority order:
  //   1. Munshot web-search (Brave) — MUNSHOT_TOKEN
  //   2. SerpAPI — SERPAPI_KEY
  //   3. Google Programmable Search — GOOGLE_API_KEY + GOOGLE_CX
  //   4. keyless fallback (works locally, blocked from most servers)
  get munshotToken(): string | undefined {
    return hostToken() ?? process.env.MUNSHOT_TOKEN;
  },
  munshotSearchUrl: process.env.MUNSHOT_SEARCH_URL || "https://fastapi.muns.io/tools/web-search",
  munshotNewsUrl: process.env.MUNSHOT_NEWS_URL || "https://fastapi.muns.io/tools/news-search",
  munshotCountry: process.env.MUNSHOT_COUNTRY || "IN",

  // Stock/company search — the typeahead behind the company box. Resolves a
  // typed fragment to real listed companies (ticker, name, sector, country),
  // so a company search starts from an entity that exists rather than free
  // text. Reuses MUNSHOT_TOKEN.
  munshotStockSearchUrl: process.env.MUNSHOT_STOCK_SEARCH_URL || "https://birdnest.muns.io/stock/search",

  // Article reader. A headline says a matter exists; only the body says what it
  // was and — the part that changes the whole reading — whether the subject
  // brought the complaint or answered it. Muns reuses MUNSHOT_TOKEN; Firecrawl
  // is the optional fallback for a publisher it cannot open.
  munshotReaderUrl: process.env.MUNSHOT_READER_URL || "https://fastapi.muns.io/tools/web-reader",
  firecrawlApiKey: process.env.FIRECRAWL_API_KEY,
  firecrawlUrl: process.env.FIRECRAWL_URL || "https://api.firecrawl.dev/v1/scrape",

  // Exchange filings & announcements (BSE/NSE/DRHP/screener.in). Same Muns
  // platform as the search backend, so it reuses MUNSHOT_TOKEN unless a
  // dedicated FILINGS_TOKEN is set. Needs a stock ticker on the subject.
  filingsUrl: process.env.FILINGS_URL || "https://devde.muns.io/filings/combined_filings_announcements",
  // A dedicated FILINGS_TOKEN is configured for this source specifically, so it
  // keeps priority; without one this rides the same session token as search.
  get filingsToken(): string | undefined {
    return process.env.FILINGS_TOKEN || hostToken() || process.env.MUNSHOT_TOKEN;
  },
  filingsCountry: process.env.FILINGS_COUNTRY || "India",
  googleApiKey: process.env.GOOGLE_API_KEY,
  googleCx: process.env.GOOGLE_CX,
  serpApiKey: process.env.SERPAPI_KEY,

  // Indian Kanoon — optional API token. Without it, the collector uses the
  // public search page.
  indianKanoonToken: process.env.INDIANKANOON_API_TOKEN,

  // Wikidata — free, keyless structured data. Used as a director/leadership
  // source: board members, CEO, chairperson and founders of a company, and the
  // reverse (companies a person leads) in director mode. No credential needed;
  // the endpoints are public. A contact URL is sent in the User-Agent per
  // Wikimedia's API etiquette. Overridable only for self-hosted mirrors.
  wikidataApiUrl: process.env.WIKIDATA_API_URL || "https://www.wikidata.org/w/api.php",
  wikidataSparqlUrl: process.env.WIKIDATA_SPARQL_URL || "https://query.wikidata.org/sparql",
  wikidataContact: process.env.WIKIDATA_CONTACT || "https://github.com/techmuns/GCheck-Pragon",

  // PrivateCircle — login for the Playwright collector.
  privateCircleEmail: process.env.PRIVATECIRCLE_EMAIL,
  privateCirclePassword: process.env.PRIVATECIRCLE_PASSWORD,

  // CIBIL Suit-filed portal — login for the Playwright collector.
  cibilUsername: process.env.CIBIL_USERNAME,
  cibilPassword: process.env.CIBIL_PASSWORD,

  // OpenAI — narrative synthesis. Now the *fallback* provider: used when
  // Bedrock has no key, or when a Bedrock call fails. Without either key the
  // deterministic assembler is used instead.
  openaiApiKey: process.env.OPENAI_API_KEY,
  openaiModel: process.env.OPENAI_MODEL || "gpt-4o-mini",

  // Claude via Amazon Bedrock — the primary narrative-synthesis backend.
  // BEDROCK_API_KEY is a Bedrock API bearer token (not an api.anthropic.com
  // key); TEMP_CLAUDE_TOKEN is the older name, still accepted. Region and the
  // model fallback chain are read directly by lib/bedrock.mjs — repeated here
  // only so admin/health surfaces can report them.
  bedrockApiKey: process.env.BEDROCK_API_KEY || process.env.TEMP_CLAUDE_TOKEN,
  bedrockRegion: process.env.BEDROCK_REGION || process.env.CLAUDE_BEDROCK_REGION || "us-east-1",

  // Optional explicit provider override. Unset (the default) means "pick by
  // which key is present, Bedrock first". Set LLM_PROVIDER=openai to put
  // OpenAI back in front.
  llmProvider: (process.env.LLM_PROVIDER || "").trim().toLowerCase(),
};

export function hasOpenAI(): boolean {
  return Boolean(env.openaiApiKey);
}

export function hasBedrockKey(): boolean {
  return Boolean(env.bedrockApiKey);
}

// Provider order (Bedrock first, OpenAI as automatic fallback) is defined once
// in ../llm-provider.mjs so scripts/llm-healthcheck.mjs shares the exact rule.
export { llmProviderChain, type LlmProvider } from "../llm-provider.mjs";

/** Can an article be opened at all? With neither credential the brief is built
 *  from headlines, and says so rather than pretending it read anything. */
export function hasReader(): boolean {
  return Boolean(env.munshotToken || env.firecrawlApiKey);
}

/** How many articles one run may open. Each costs a reader call and an LLM
 *  extraction, so it is the main cost dial on a deep run. */
export function maxArticleReads(): number {
  const raw = Number(process.env.MAX_ARTICLE_READS);
  return Number.isFinite(raw) && raw > 0 ? raw : 8;
}

export function hasPrivateCircleCreds(): boolean {
  return Boolean(env.privateCircleEmail && env.privateCirclePassword);
}

export function hasCibilCreds(): boolean {
  return Boolean(env.cibilUsername && env.cibilPassword);
}

export function hasFilings(): boolean {
  return Boolean(env.filingsToken);
}
