// ── Credential / key configuration ─────────────────────────────────────────
// All source credentials come from environment variables. Nothing is committed.
// A missing value simply means that source (or its richer mode) stays off, and
// the collector reports that honestly.

export const env = {
  // Google / web search backends, in priority order:
  //   1. Munshot web-search (Brave) — MUNSHOT_TOKEN
  //   2. SerpAPI — SERPAPI_KEY
  //   3. Google Programmable Search — GOOGLE_API_KEY + GOOGLE_CX
  //   4. keyless fallback (works locally, blocked from most servers)
  munshotToken: process.env.MUNSHOT_TOKEN,
  munshotSearchUrl: process.env.MUNSHOT_SEARCH_URL || "https://fastapi.muns.io/tools/web-search",
  munshotNewsUrl: process.env.MUNSHOT_NEWS_URL || "https://fastapi.muns.io/tools/news-search",
  munshotCountry: process.env.MUNSHOT_COUNTRY || "IN",

  // Exchange filings & announcements (BSE/NSE/DRHP/screener.in). Same Muns
  // platform as the search backend, so it reuses MUNSHOT_TOKEN unless a
  // dedicated FILINGS_TOKEN is set. Needs a stock ticker on the subject.
  filingsUrl: process.env.FILINGS_URL || "https://devde.muns.io/filings/combined_filings_announcements",
  filingsToken: process.env.FILINGS_TOKEN || process.env.MUNSHOT_TOKEN,
  filingsCountry: process.env.FILINGS_COUNTRY || "India",
  googleApiKey: process.env.GOOGLE_API_KEY,
  googleCx: process.env.GOOGLE_CX,
  serpApiKey: process.env.SERPAPI_KEY,

  // Indian Kanoon — optional API token. Without it, the collector uses the
  // public search page.
  indianKanoonToken: process.env.INDIANKANOON_API_TOKEN,

  // MCA (Ministry of Corporate Affairs) — the official Indian company registry,
  // the authoritative source for directors + financials of unlisted companies.
  // There is no free/keyless MCA API (financials are paid document access), so
  // this collector activates only when a data-provider token is configured and
  // skips honestly otherwise. MCA_API_URL points at the provider endpoint that
  // takes a company name/CIN and returns master-data + directors + financials.
  mcaApiToken: process.env.MCA_API_TOKEN,
  mcaApiUrl: process.env.MCA_API_URL || "https://api.mca.gov.in/company",

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

  // OpenAI — narrative synthesis (Phase 3). Without a key, the deterministic
  // assembler is used instead.
  openaiApiKey: process.env.OPENAI_API_KEY,
  openaiModel: process.env.OPENAI_MODEL || "gpt-4o-mini",
};

export function hasOpenAI(): boolean {
  return Boolean(env.openaiApiKey);
}

export function hasPrivateCircleCreds(): boolean {
  return Boolean(env.privateCircleEmail && env.privateCirclePassword);
}

export function hasCibilCreds(): boolean {
  return Boolean(env.cibilUsername && env.cibilPassword);
}

export function hasMca(): boolean {
  return Boolean(env.mcaApiToken);
}

export function hasFilings(): boolean {
  return Boolean(env.filingsToken);
}
