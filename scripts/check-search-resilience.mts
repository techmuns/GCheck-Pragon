// ── Search-backend resilience check ────────────────────────────────────────
// Every search backend went down at once — an expired MUNSHOT_TOKEN answering
// 403, a SerpAPI account answering `{"error":"Your account has run out of
// searches."}`, and the keyless web engine unreachable from the server — and
// five separate sources reported "unavailable" with five raw HTTP errors
// between them. Three things were wrong beyond the dead credentials:
//
//   1. News had no floor. Its chain ended at SerpAPI, so both credentials
//      failing took the whole source dark.
//   2. Standing failures were retried. `withRetry` re-issued every call once,
//      including the ones that cannot ever succeed, and nothing remembered a
//      dead backend between the ~24 queries of a sweep.
//   3. The error said what happened, not what to do about it.
//
// This pins all three, plus the parser for the keyless feed.
//
//   npm run check:search

import assert from "node:assert/strict";

// Credentials must exist before anything imports `collectors/env`, which
// snapshots process.env once at module load. Set here, imported dynamically
// below: this is the configuration the outage happened in — both keys present,
// both dead.
process.env.MUNSHOT_TOKEN = "expired.session.jwt";
process.env.SERPAPI_KEY = "spent-quota-key";
process.env.MAX_NEWS_QUERIES = "2";

const {
  classifyError,
  classifyStatus,
  isBackendDown,
  isRetryable,
  noteBackendFailure,
  noteBackendSuccess,
  planAttempts,
  remedyFor,
  resetBackendHealth,
} = await import("../lib/collectors/backendHealth");
const { newsChain, parseRss, newsCollector } = await import("../lib/collectors/news");

let failures = 0;
function check(name: string, fn: () => void): void {
  try {
    resetBackendHealth();
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  FAIL ${name}`);
    console.error(`       ${err instanceof Error ? err.message : String(err)}`);
  }
}

console.log("\nClassification — a spent plan is not a rate limit");

check("SerpAPI's exhaustion body classifies as exhausted, not throttled", () => {
  const body = '{ "error": "Your account has run out of searches." }';
  assert.equal(classifyStatus(429, body), "exhausted");
});

check("a bare 429 with no such body is a retryable throttle", () => {
  assert.equal(classifyStatus(429, "slow down"), "throttled");
  assert.equal(isRetryable("throttled"), true);
});

check("a rejected credential is auth, and is never retried", () => {
  assert.equal(classifyStatus(403, "Invalid authentication token - unauthorized"), "auth");
  assert.equal(classifyStatus(401, ""), "auth");
  assert.equal(isRetryable("auth"), false);
  assert.equal(isRetryable("exhausted"), false);
});

check("5xx and socket failures stay retryable", () => {
  assert.equal(classifyStatus(503, ""), "transient");
  assert.equal(classifyError(new Error("fetch failed")), "transient");
  assert.equal(isRetryable("transient"), true);
});

check("the real production messages classify correctly end to end", () => {
  // Verbatim from the failing run.
  assert.equal(classifyError(new Error('SerpAPI news 429: { "error": "Your account has run out of searches." }')), "exhausted");
  assert.equal(classifyError(new Error("Munshot search 403: Invalid authentication token - unauthorized")), "auth");
});

console.log("\nThe breaker — a dead backend is asked once, not 24 times");

check("a standing failure benches the backend immediately", () => {
  assert.equal(noteBackendFailure("serpapi", "exhausted", "out of searches"), true);
  assert.equal(isBackendDown("serpapi"), true);
});

check("one blip does not bench anything; three in a row does", () => {
  assert.equal(noteBackendFailure("munshot", "transient", "fetch failed"), false);
  assert.equal(isBackendDown("munshot"), false);
  noteBackendFailure("munshot", "transient", "fetch failed");
  assert.equal(noteBackendFailure("munshot", "transient", "fetch failed"), true);
  assert.equal(isBackendDown("munshot"), true);
});

check("a recovered backend is trusted again", () => {
  noteBackendFailure("serpapi", "exhausted", "out of searches");
  assert.equal(isBackendDown("serpapi"), true);
  noteBackendSuccess("serpapi");
  assert.equal(isBackendDown("serpapi"), false);
});

check("the bench expires, so a topped-up key recovers without a redeploy", () => {
  const now = Date.now();
  noteBackendFailure("serpapi", "exhausted", "out of searches", now);
  assert.equal(isBackendDown("serpapi", now + 60_000), true, "still benched a minute later");
  assert.equal(isBackendDown("serpapi", now + 31 * 60_000), false, "released after the cooldown");
});

check("web and news share one SerpAPI quota, so one 429 benches both", () => {
  // Both sweeps key the breaker on the service, not on their own chain slot —
  // the quota is the account's, not the endpoint's.
  noteBackendFailure("serpapi", "exhausted", "out of searches");
  assert.equal(isBackendDown("serpapi"), true);
});

check("a blocked keyless web engine does not bench the keyless news feed", () => {
  // These are different services sharing the name "fallback" in the old chain.
  // Conflating them would take news down for a DuckDuckGo outage.
  noteBackendFailure("ddg", "transient", "fetch failed");
  noteBackendFailure("ddg", "transient", "fetch failed");
  noteBackendFailure("ddg", "transient", "fetch failed");
  assert.equal(isBackendDown("ddg"), true);
  assert.equal(isBackendDown("gnews"), false, "news must survive a dead web fallback");
});

check("a healthy chain is attempted in order, untouched", () => {
  assert.deepEqual(planAttempts(["munshot", "serpapi", "gnews"]).attempt, ["munshot", "serpapi", "gnews"]);
});

check("benched backends drop out, the rest are still attempted", () => {
  noteBackendFailure("munshot", "auth", "403");
  assert.deepEqual(planAttempts(["munshot", "serpapi", "gnews"]).attempt, ["serpapi", "gnews"]);
});

check("all throttled — one is still probed, because a throttle passes", () => {
  noteBackendFailure("munshot", "throttled", "429");
  const plan = planAttempts(["munshot"]);
  assert.equal(plan.attempt.length, 1, "a throttle is worth re-probing");
});

check("all standing-failed — nothing is probed, and the cause is carried", () => {
  noteBackendFailure("munshot", "auth", "Munshot news 403: Invalid authentication token");
  const plan = planAttempts(["munshot"]);
  assert.deepEqual(plan.attempt, [], "a rejected credential is not worth a second call");
  assert.match(plan.knownFailures[0], /Invalid authentication token/);
  assert.deepEqual(plan.knownKinds, ["auth"]);
});

console.log("\nNews has a floor — the outage that started this");

check("the keyless floor is appended unconditionally, and stays last", () => {
  // Both credentials are configured here, so this also pins the ordering: the
  // keyless feed never displaces a keyed backend, it only catches what falls
  // through. With neither key set the same push leaves ["gnews"] — a chain of
  // one, where it used to leave an empty chain and a skipped source.
  assert.deepEqual(newsChain(), ["munshot", "serpapi", "gnews"]);
});

console.log("\nParsing the keyless feed");

const SAMPLE = `<?xml version="1.0"?><rss version="2.0"><channel>
<title>"Saarthi" - Google News</title>
<item>
  <title>Saarthi Pedagogy faces NCLT insolvency plea - The Economic Times</title>
  <link>https://news.google.com/rss/articles/CBMiXWh0dHBz</link>
  <pubDate>Mon, 04 Aug 2026 10:30:00 GMT</pubDate>
  <source url="https://economictimes.indiatimes.com">The Economic Times</source>
</item>
<item>
  <title><![CDATA[Founder responds to fraud allegations &amp; files counter-suit - Mint]]></title>
  <link>https://news.google.com/rss/articles/CBMiQWh0dHBz</link>
  <pubDate>Tue, 05 Aug 2026 06:00:00 GMT</pubDate>
  <source url="https://livemint.com">Mint</source>
</item>
</channel></rss>`;

check("items parse with title, url and date", () => {
  const rows = parseRss(SAMPLE);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].url, "https://news.google.com/rss/articles/CBMiXWh0dHBz");
  assert.equal(rows[0].date, "Mon, 04 Aug 2026 10:30:00 GMT");
});

check("the publisher suffix is split off the headline, not left in it", () => {
  // Left in, "The Economic Times" would satisfy an entity match for a story
  // that never names the company the query was about.
  const rows = parseRss(SAMPLE);
  assert.equal(rows[0].title, "Saarthi Pedagogy faces NCLT insolvency plea");
  assert.equal(rows[0].snippet, "The Economic Times");
});

check("CDATA and escaped entities both decode", () => {
  const rows = parseRss(SAMPLE);
  assert.equal(rows[1].title, "Founder responds to fraud allegations & files counter-suit");
});

check("a feed in an unexpected shape yields nothing rather than throwing", () => {
  assert.deepEqual(parseRss("<rss><channel></channel></rss>"), []);
  assert.deepEqual(parseRss("not xml at all"), []);
});

console.log("\nThe message tells the operator what to do");

check("an auth failure names the token to refresh", () => {
  assert.match(remedyFor(["auth"]), /MUNSHOT_TOKEN/);
});

check("an exhausted quota names the keys that would restore search", () => {
  const fix = remedyFor(["exhausted"]);
  assert.match(fix, /SERPAPI_KEY/);
  assert.match(fix, /GOOGLE_API_KEY/);
});

check("the real outage — both at once — gets both instructions", () => {
  const fix = remedyFor(["auth", "exhausted"]);
  assert.match(fix, /MUNSHOT_TOKEN/);
  assert.match(fix, /SERPAPI_KEY/);
});

check("a transient blip prescribes nothing — there is nothing to fix", () => {
  assert.equal(remedyFor(["transient"]), "");
});

// ── End to end, against the real outage ────────────────────────────────────
// Everything above tests a part. This replays the whole failure: a 403 from
// Munshot and a 429-out-of-searches from SerpAPI, exactly as production
// returned them, and asserts the sweep completes anyway.

console.log("\nEnd to end — both credentials dead, as they were in production");

const realFetch = globalThis.fetch;
const calls: string[] = [];

globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  calls.push(url);
  if (url.includes("fastapi.muns.io")) {
    return new Response('{"detail":"Invalid authentication token - unauthorized"}', { status: 403 });
  }
  if (url.includes("serpapi.com")) {
    return new Response('{ "error": "Your account has run out of searches." }', { status: 429 });
  }
  if (url.includes("news.google.com")) {
    return new Response(SAMPLE, { status: 200 });
  }
  // The article reader, with no credential that works — reading is expected to
  // fail here, and the sweep must still deliver its headlines.
  return new Response("", { status: 404 });
}) as typeof fetch;

resetBackendHealth();
const result = await newsCollector({
  subject: { type: "director", company: "Saarthi Pedagogy", promoters: [], din: "01234567" },
  keywords: ["fraud"],
});
globalThis.fetch = realFetch;

const hostCalls = (needle: string) => calls.filter((u) => u.includes(needle)).length;

check("the sweep completes instead of reporting 'Couldn't reach'", () => {
  assert.equal(result.status, "done", `expected done, got ${result.status}: ${result.note}`);
});

check("it returns real articles from the keyless feed", () => {
  assert.ok(result.hits.length > 0, "expected hits from the Google News fallback");
  assert.ok(
    result.hits.some((h) => h.title.includes("NCLT insolvency plea")),
    "expected the story the feed returned",
  );
});

check("the brief says it ran degraded rather than passing it off as a full sweep", () => {
  assert.match(result.note ?? "", /keyless Google News feed/);
});

check("each dead backend is called once, not once per query", () => {
  // Two queries were planned. Before the breaker that meant 2 queries x 2
  // backends x 2 (the blind retry) = 8 doomed calls; on a full 24-query sweep,
  // 96. Now the first failure benches the backend for the rest of the run.
  assert.equal(hostCalls("tools/news-search"), 1, `munshot news called ${hostCalls("tools/news-search")}x, expected 1`);
  assert.equal(hostCalls("serpapi.com"), 1, `serpapi called ${hostCalls("serpapi.com")}x, expected 1`);
});

check("the working backend serves every query", () => {
  assert.equal(hostCalls("news.google.com"), 2, "both planned queries should reach the live feed");
});

check("a token already known dead is not re-offered to the article reader", () => {
  // Reading rides the same MUNSHOT_TOKEN. Once search has established that it
  // is rejected, spending the codebase's longest timeout to be told so again —
  // once per batch — is pure cost.
  assert.equal(hostCalls("tools/web-reader"), 0, "the reader should have skipped the benched token");
});

console.log(
  failures === 0 ? "\nAll search-resilience checks passed.\n" : `\n${failures} check(s) FAILED.\n`,
);
process.exit(failures === 0 ? 0 : 1);
