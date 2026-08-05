import { AsyncLocalStorage } from "node:async_hooks";

// ── The caller's Munshot session token, for the length of one request ───────
//
// Every Munshot-backed source here — web search, news, the article reader, the
// stock typeahead, exchange filings — authenticates with a Munshot *user
// session* JWT. `MUNSHOT_TOKEN` holds one, and that is the whole problem: a
// session JWT expires, and an expired one answers 403 to every request it will
// ever receive. When it lapses, every Munshot-backed source in the run goes
// down together and the brief comes back saying so.
//
// Inside the Munshot host the dashboard is handed a live session token on
// host:init and again on every host:context:update, and forwards it on each
// API call. Preferring that token means the sources are authenticated as
// whoever is actually using the dashboard, and a stale MUNSHOT_TOKEN can no
// longer strand a run. Outside the host nothing changes: no header arrives and
// the environment token is used exactly as before.
//
// The token is held per-request in AsyncLocalStorage rather than passed down
// through every collector signature, because the collectors already read their
// credentials off `env` and threading a token through twelve of them would be
// the larger change.

/** A box rather than a bare string, so a token that arrives while a run is
 *  already in flight reaches the collectors still working under it. */
interface TokenRef {
  token: string | undefined;
}

const store = new AsyncLocalStorage<TokenRef>();

/** Bearer token from an incoming request, or undefined if there isn't one. */
export function bearerFrom(req: { headers: { get(name: string): string | null } }): string | undefined {
  const raw = req.headers.get("authorization");
  if (!raw) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(raw.trim());
  const token = match?.[1]?.trim();
  // "Bearer null"/"Bearer undefined" is what a client sends when it stringifies
  // an absent token. Treat it as absent rather than passing it upstream to be
  // rejected — the environment token is the better answer.
  if (!token || token === "null" || token === "undefined") return undefined;
  return token;
}

/** Run `fn` with `token` as the session token every collector under it will use. */
export function withHostToken<T>(token: string | undefined, fn: () => T): T {
  return store.run({ token }, fn);
}

/** The session token in scope, if the caller supplied one. */
export function hostToken(): string | undefined {
  return store.getStore()?.token;
}

// ── Detached runs ──────────────────────────────────────────────────────────
// A run outlives the POST that started it — the workflow is fired without
// blocking the response and then works for minutes. So the token is held
// against the run id and re-established when the workflow starts, rather than
// relying on the request's async scope still being around.

const byRun = new Map<string, TokenRef>();

/** Bounded so a workflow that never reaches its `forget` cannot grow this
 *  without limit. Insertion order is Map's iteration order, so the first key is
 *  the coldest. Sized above the client's own cap on tracked runs. */
const MAX_REMEMBERED = 32;

/**
 * Hold the session token a run should work under.
 *
 * Called again on every poll for that run, which is what keeps a long run
 * alive: the host issues a fresh token on login and session refresh, the client
 * carries it on the next poll, and the box is updated in place so the sources
 * still working pick it up on their next call rather than continuing with the
 * token the run happened to start with.
 */
export function rememberRunToken(runId: string, token: string | undefined): void {
  if (!token) return;
  const held = byRun.get(runId);
  if (held) {
    held.token = token;
    return;
  }
  byRun.set(runId, { token });
  while (byRun.size > MAX_REMEMBERED) {
    const oldest = byRun.keys().next();
    if (oldest.done) break;
    byRun.delete(oldest.value);
  }
}

/** Run `fn` under whatever token this run currently holds. */
export function withRunToken<T>(runId: string, fn: () => T): T {
  return store.run(byRun.get(runId) ?? { token: undefined }, fn);
}

export function forgetRunToken(runId: string): void {
  byRun.delete(runId);
}
