// ── Host session token check ───────────────────────────────────────────────
// Every Munshot-backed source here authenticates with a Munshot *user session*
// JWT. MUNSHOT_TOKEN holds one, and a session JWT expires — when it does, the
// whole run comes back "Invalid authentication token - unauthorized" with every
// Munshot source dark at once.
//
// Inside the Munshot host the dashboard is handed a live token on host:init and
// on every host:context:update, and forwards it as `Authorization: Bearer …` on
// each API call. This pins the server half of that:
//
//   1. The bearer is parsed off the request, and a stringified absent token
//      ("Bearer null") is treated as no token rather than passed upstream.
//   2. Inside a request's token scope, the collectors use the caller's token;
//      outside one they use the environment's, exactly as before.
//   3. A dedicated FILINGS_TOKEN still outranks both.
//   4. The token reaches the actual upstream Authorization header.
//   5. A run's token can be refreshed while that run is still in flight, so a
//      20-minute sweep is not killed by the token it happened to start with.
//
//   npm run check:host-token

import assert from "node:assert/strict";

// Set before importing collectors/env — the module reads process.env for the
// fallback, and this is the configuration the outage happened in: an
// environment token that the upstream rejects.
process.env.MUNSHOT_TOKEN = "expired.session.jwt";

const { bearerFrom, withHostToken, hostToken, rememberRunToken, withRunToken, forgetRunToken } =
  await import("../lib/hostToken");
const { env } = await import("../lib/collectors/env");
const { searchStocks } = await import("../lib/collectors/stocks");

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

/** A request-like object carrying only what `bearerFrom` reads. */
function req(headers: Record<string, string>) {
  const lower = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { headers: { get: (name: string) => lower.get(name.toLowerCase()) ?? null } };
}

console.log("\nHost session token");

check("reads a bearer token off the request", () => {
  assert.equal(bearerFrom(req({ Authorization: "Bearer live.host.jwt" })), "live.host.jwt");
  assert.equal(bearerFrom(req({ authorization: "bearer live.host.jwt" })), "live.host.jwt");
});

check("treats an absent or stringified-null token as no token", () => {
  assert.equal(bearerFrom(req({})), undefined);
  assert.equal(bearerFrom(req({ Authorization: "" })), undefined);
  assert.equal(bearerFrom(req({ Authorization: "Bearer " })), undefined);
  // What a client sends when it interpolates a token it does not have. Passing
  // it upstream would only earn a 403 — the environment token is the better
  // answer, so it must read as absent.
  assert.equal(bearerFrom(req({ Authorization: "Bearer null" })), undefined);
  assert.equal(bearerFrom(req({ Authorization: "Bearer undefined" })), undefined);
});

check("prefers the caller's token, and falls back to the environment's", () => {
  assert.equal(env.munshotToken, "expired.session.jwt", "outside a request: the environment token");
  withHostToken("live.host.jwt", () => {
    assert.equal(hostToken(), "live.host.jwt");
    assert.equal(env.munshotToken, "live.host.jwt", "inside a request: the caller's token");
  });
  // The scope is per-request; nothing leaks out of it into the next one.
  assert.equal(env.munshotToken, "expired.session.jwt");
  assert.equal(hostToken(), undefined);
});

check("a request without a token still uses the environment's", () => {
  withHostToken(undefined, () => {
    assert.equal(env.munshotToken, "expired.session.jwt");
  });
});

check("a dedicated FILINGS_TOKEN outranks both", () => {
  withHostToken("live.host.jwt", () => {
    assert.equal(env.filingsToken, "live.host.jwt", "no FILINGS_TOKEN: the session token");
  });
  process.env.FILINGS_TOKEN = "filings.service.token";
  try {
    withHostToken("live.host.jwt", () => {
      assert.equal(env.filingsToken, "filings.service.token");
    });
  } finally {
    delete process.env.FILINGS_TOKEN;
  }
});

// ── The token actually reaches the wire ────────────────────────────────────
// The checks above pin what `env` reports. This one pins what is sent, which is
// the thing the upstream 403 was actually about.

const realFetch = globalThis.fetch;
function captureAuth(): { seen: string[] } {
  const seen: string[] = [];
  globalThis.fetch = (async (_url: string, init: RequestInit = {}) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    seen.push(headers.Authorization ?? headers.authorization ?? "");
    return new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof globalThis.fetch;
  return { seen };
}

await check("sends the caller's token upstream", async () => {
  const { seen } = captureAuth();
  try {
    // Distinct queries throughout — the stock search is cached per query, and a
    // cache hit would answer without a request to inspect.
    await withHostToken("live.host.jwt", () => searchStocks("reliance industries"));
    assert.deepEqual(seen, ["Bearer live.host.jwt"]);
  } finally {
    globalThis.fetch = realFetch;
  }
});

await check("falls back to the environment token upstream", async () => {
  const { seen } = captureAuth();
  try {
    await searchStocks("tata consultancy");
    assert.deepEqual(seen, ["Bearer expired.session.jwt"]);
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ── Detached runs ──────────────────────────────────────────────────────────

check("a run works under the token it was started with", () => {
  rememberRunToken("run-1", "live.host.jwt");
  withRunToken("run-1", () => {
    assert.equal(env.munshotToken, "live.host.jwt");
  });
  forgetRunToken("run-1");
  // Forgotten runs fall back rather than holding a stale token.
  withRunToken("run-1", () => {
    assert.equal(env.munshotToken, "expired.session.jwt");
  });
});

check("a refreshed token reaches a run already in flight", () => {
  rememberRunToken("run-2", "first.jwt");
  withRunToken("run-2", () => {
    assert.equal(env.munshotToken, "first.jwt");
    // The client polls twice a second carrying whatever token the host has most
    // recently given it. A run that outlives its token is re-authenticated by
    // its own poll rather than dying halfway through the sweep.
    rememberRunToken("run-2", "refreshed.jwt");
    assert.equal(env.munshotToken, "refreshed.jwt", "the sources still running pick up the new token");
  });
  forgetRunToken("run-2");
});

check("a run started without a token is unaffected by later ones", () => {
  withRunToken("never-seen", () => {
    assert.equal(env.munshotToken, "expired.session.jwt");
  });
});

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.\n`);
  process.exit(1);
}
console.log("\nAll host-token checks passed.\n");
