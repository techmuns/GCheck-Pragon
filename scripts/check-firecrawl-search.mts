// ── Firecrawl-as-search-backend check ──────────────────────────────────────
// Firecrawl was only ever an article reader here. That left a deploy holding a
// Munshot token and nothing else with no floor under web search: when the token
// lapsed, the chain fell through to the keyless engine, which is blocked from
// most cloud servers, and every search-backed source went dark together.
//
// The same credential answers searches, so it now sits at the back of the web
// chain. This pins two things:
//
//   1. It joins the chain when the key is present, behind the dedicated search
//      APIs (it is metered and slower) and ahead of the keyless engine.
//   2. Its response is parsed across every envelope Firecrawl has shipped for
//      this endpoint. That tolerance is the point: the shapes are the risk.
//
//   npm run check:firecrawl

import assert from "node:assert/strict";

// Set before importing collectors/env — the Firecrawl key is read at module
// load. Deliberately no MUNSHOT_TOKEN/SERPAPI_KEY: this is the configuration
// the outage left behind, where Firecrawl is the only credential standing.
process.env.FIRECRAWL_API_KEY = "fc-test-key";
delete process.env.MUNSHOT_TOKEN;
delete process.env.SERPAPI_KEY;
delete process.env.GOOGLE_API_KEY;
delete process.env.GOOGLE_CX;

const { backendChain, parseFirecrawl, runBackend } = await import("../lib/collectors/google");
const { tokenHealth } = await import("../lib/tokenHealth");

let failures = 0;
function check(name: string, fn: () => void | Promise<void>): Promise<void> | void {
  const done = (err?: unknown) => {
    if (err) {
      failures += 1;
      console.error(`  ✗ ${name}`);
      console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    } else {
      console.log(`  ✓ ${name}`);
    }
  };
  try {
    const out = fn();
    if (out instanceof Promise) return out.then(() => done()).catch(done);
    done();
  } catch (err) {
    done(err);
  }
}

console.log("\nFirecrawl search backend");

check("joins the chain, ahead of the keyless engine", () => {
  const chain = backendChain();
  assert.deepEqual(chain, ["firecrawl", "fallback"]);
});

check("counts as a durable fallback in health", () => {
  // Without this the health endpoint reports "no durable backend" and a 503,
  // while search is in fact still being served.
  assert.equal(tokenHealth().hasFallback, true);
});

// ── Response shapes ────────────────────────────────────────────────────────

check("reads a bare data array", () => {
  assert.deepEqual(
    parseFirecrawl({
      success: true,
      data: [{ url: "https://a.test/1", title: "A", description: "first" }],
    }),
    [{ title: "A", url: "https://a.test/1", snippet: "first" }],
  );
});

check("reads a data.web array", () => {
  assert.deepEqual(
    parseFirecrawl({
      success: true,
      data: { web: [{ url: "https://b.test/2", title: "B", description: "second" }] },
    }),
    [{ title: "B", url: "https://b.test/2", snippet: "second" }],
  );
});

check("reads a results array", () => {
  assert.deepEqual(
    parseFirecrawl({ results: [{ url: "https://c.test/3", title: "C" }] }),
    [{ title: "C", url: "https://c.test/3", snippet: undefined }],
  );
});

check("accepts link where url is absent, and snippet where description is", () => {
  assert.deepEqual(
    parseFirecrawl({ data: [{ link: "https://d.test/4", title: "D", snippet: "fourth" }] }),
    [{ title: "D", url: "https://d.test/4", snippet: "fourth" }],
  );
});

check("drops rows carrying no link at all", () => {
  // A result with no URL cannot be cited, and an uncitable hit in a governance
  // brief is worse than no hit.
  assert.deepEqual(parseFirecrawl({ data: [{ title: "no link" }] }), []);
});

check("survives an unrecognised body instead of throwing", () => {
  // A shape change must degrade to "this backend found nothing" and let the
  // chain move on — never take the sweep down with a TypeError.
  for (const body of [null, undefined, {}, "nonsense", 42, { data: null }, { data: { web: "no" } }]) {
    assert.deepEqual(parseFirecrawl(body), [], `body: ${JSON.stringify(body)}`);
  }
});

// ── The request itself ─────────────────────────────────────────────────────

const realFetch = globalThis.fetch;

await check("posts the query with the Firecrawl bearer", async () => {
  const seen: { url?: string; auth?: string; body?: unknown } = {};
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    seen.url = String(url);
    seen.auth = headers.Authorization;
    seen.body = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ data: [{ url: "https://e.test/5", title: "E" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;

  try {
    const out = await runBackend("firecrawl", "reliance governance");
    assert.equal(seen.url, "https://api.firecrawl.dev/v1/search");
    assert.equal(seen.auth, "Bearer fc-test-key");
    assert.deepEqual(seen.body, { query: "reliance governance", limit: 10 });
    assert.deepEqual(out, [{ title: "E", url: "https://e.test/5", snippet: undefined }]);
  } finally {
    globalThis.fetch = realFetch;
  }
});

await check("a rejected key surfaces as a named backend failure", async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    })) as typeof globalThis.fetch;
  try {
    await assert.rejects(
      () => runBackend("firecrawl", "anything"),
      (err: Error) => {
        // The message has to name Firecrawl: "search failed" with no backend in
        // it is what made the original outage take an afternoon to read.
        assert.match(err.message, /Firecrawl/i);
        return true;
      },
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.\n`);
  process.exit(1);
}
console.log("\nAll Firecrawl search checks passed.\n");
