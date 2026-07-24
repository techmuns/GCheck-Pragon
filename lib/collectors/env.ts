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
  googleApiKey: process.env.GOOGLE_API_KEY,
  googleCx: process.env.GOOGLE_CX,
  serpApiKey: process.env.SERPAPI_KEY,

  // Indian Kanoon — optional API token. Without it, the collector uses the
  // public search page.
  indianKanoonToken: process.env.INDIANKANOON_API_TOKEN,

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
