// ── Backend failure classification & circuit breaker ───────────────────────
//
// A search backend can fail in ways that mean very different things, and the
// old code treated them all as one: throw, sleep 1.2s, try the identical call
// again, then move on and repeat the whole thing for the next query.
//
// That is actively harmful when the failure is a *standing* one. An expired
// MUNSHOT_TOKEN answers 403 to every request it will ever receive; a SerpAPI
// account that has "run out of searches" answers 429 to every request until the
// month rolls over. Retrying either is guaranteed waste, and a news sweep plans
// up to 24 queries — so one dead credential cost 48 doomed HTTP calls and ~29s
// of pure sleeping, per source, per run. That is enough to burn the source
// deadline that a *working* backend needed in order to finish.
//
// So failures are classified, and a backend that reports a standing failure is
// taken out of the chain for a cooldown instead of being asked again. The
// cooldown (rather than a permanent kill) is what lets a topped-up key or a
// refreshed token recover without a redeploy.

export type FailureKind =
  /** Quota/credit is gone. Will not recover until the plan resets or is topped up. */
  | "exhausted"
  /** Credential rejected or missing. Will not recover until it is replaced. */
  | "auth"
  /** Rate-limited, but the credential is fine. Recovers on its own, shortly. */
  | "throttled"
  /** A blip — 5xx, socket error, timeout. Usually recovers immediately. */
  | "transient";

/** A failure that carries what kind it is, so callers can decide without
 *  re-parsing a message string. */
export class BackendError extends Error {
  constructor(
    message: string,
    readonly kind: FailureKind,
    readonly backend: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "BackendError";
  }
}

/** Only these are worth trying again inside a single call. */
export function isRetryable(kind: FailureKind): boolean {
  return kind === "throttled" || kind === "transient";
}

/** Wording that means "the plan is spent", as distinct from "slow down". Both
 *  arrive as 429, and only the body tells them apart — SerpAPI's exhaustion
 *  reads `{"error":"Your account has run out of searches."}`. */
const EXHAUSTED_BODY =
  /run out of searches|out of searches|quota|exceeded your|exhaust|monthly limit|plan limit|insufficient credit|no credits|billing/i;

/**
 * Classify an HTTP failure.
 *
 * `body` is the response text when we have it — it is the only thing that
 * separates a spent plan from a burst limit, and getting that wrong means
 * either hammering a wall or giving up on a backend that would have answered a
 * second later.
 */
export function classifyStatus(status: number, body = ""): FailureKind {
  if (status === 401 || status === 403) return "auth";
  // 402 Payment Required is unambiguous.
  if (status === 402) return "exhausted";
  if (status === 429) return EXHAUSTED_BODY.test(body) ? "exhausted" : "throttled";
  if (status >= 500) return "transient";
  return "transient";
}

/** Classify a thrown error — a socket failure, an abort, or a BackendError
 *  that already knows what it is. */
export function classifyError(err: unknown): FailureKind {
  if (err instanceof BackendError) return err.kind;
  const msg = err instanceof Error ? err.message : String(err);
  if (EXHAUSTED_BODY.test(msg)) return "exhausted";
  if (/\b(401|403)\b|unauthor|invalid authentication|forbidden/i.test(msg)) return "auth";
  if (/\b429\b|rate.?limit|too many requests/i.test(msg)) return "throttled";
  return "transient";
}

// ── The breaker ────────────────────────────────────────────────────────────

interface Down {
  kind: FailureKind;
  reason: string;
  /** Epoch ms after which the backend is tried again. */
  until: number;
  /** Consecutive transient failures — a blip should not open the breaker. */
  strikes: number;
}

interface HealthStore {
  down: Map<string, Down>;
}

// On globalThis for the same reason the search cache is: Next.js gives separate
// route bundles separate module instances, and a breaker that resets per route
// would never actually stop anything.
const g = globalThis as unknown as { __paragonBackendHealth?: HealthStore };
const store: HealthStore = (g.__paragonBackendHealth ??= { down: new Map() });

/**
 * How long a backend stays out of the chain, by what went wrong.
 *
 * Standing failures get a long cooldown because re-probing them is pure cost —
 * but not an infinite one, because the fix for both is a credential change that
 * we want picked up without a redeploy.
 */
const COOLDOWN_MS: Record<FailureKind, number> = {
  exhausted: 30 * 60_000,
  auth: 30 * 60_000,
  throttled: 60_000,
  transient: 20_000,
};

/** Consecutive transient failures before a backend is benched. One socket
 *  error is weather; three in a row is a dead host. */
const TRANSIENT_STRIKES = 3;

/**
 * Record a failure. Returns true if the backend is now benched.
 *
 * A standing failure benches immediately — there is nothing to learn from a
 * second 403. A transient one has to happen repeatedly first.
 */
export function noteBackendFailure(backend: string, kind: FailureKind, reason: string, now = Date.now()): boolean {
  const prior = store.down.get(backend);
  const strikes = kind === "transient" ? (prior?.strikes ?? 0) + 1 : 0;

  if (kind === "transient" && strikes < TRANSIENT_STRIKES) {
    store.down.set(backend, { kind, reason, until: 0, strikes });
    return false;
  }

  store.down.set(backend, { kind, reason, until: now + COOLDOWN_MS[kind], strikes });
  return true;
}

/** A backend answered — clear its record so a recovered key is trusted again. */
export function noteBackendSuccess(backend: string): void {
  store.down.delete(backend);
}

export function isBackendDown(backend: string, now = Date.now()): boolean {
  const d = store.down.get(backend);
  return d !== undefined && d.until > now;
}

export function backendDownReason(backend: string, now = Date.now()): string | undefined {
  const d = store.down.get(backend);
  return d && d.until > now ? d.reason : undefined;
}

/**
 * Decide what to actually call.
 *
 * The subtlety is what to do when *every* backend is benched. Trying one anyway
 * is right for a throttle or a socket blip — those pass on their own, and the
 * probe is how we find out. It is wrong for a rejected credential or a spent
 * quota: those are exactly the failures whose answer we already have, and the
 * probe costs a full timeout to be told so again. The reader shows the cost
 * plainly — it runs on a 45s timeout, once per batch.
 *
 * So a standing failure yields no attempt and the recorded reason instead,
 * which is also a better error than a fresh one: it names the original cause
 * rather than whatever the last rung of the chain happened to say.
 */
export function planAttempts<T extends string>(
  chain: T[],
  keyOf: (backend: T) => string = (b) => b,
  now = Date.now(),
): { attempt: T[]; knownFailures: string[]; knownKinds: FailureKind[] } {
  const live = chain.filter((b) => !isBackendDown(keyOf(b), now));
  if (live.length > 0) return { attempt: live, knownFailures: [], knownKinds: [] };

  const recoverable = chain.filter((b) => {
    const d = store.down.get(keyOf(b));
    return d?.kind === "throttled" || d?.kind === "transient";
  });
  if (recoverable.length > 0) return { attempt: recoverable, knownFailures: [], knownKinds: [] };

  const benched = chain.map((b) => store.down.get(keyOf(b))).filter((d): d is Down => d !== undefined);
  return {
    attempt: [],
    knownFailures: benched.map((d) => d.reason),
    knownKinds: benched.map((d) => d.kind),
  };
}

/** For /api/health and the admin panel. */
export function backendHealthSnapshot(now = Date.now()): Array<{
  backend: string;
  kind: FailureKind;
  reason: string;
  secondsRemaining: number;
}> {
  const out = [];
  for (const [backend, d] of store.down) {
    if (d.until <= now) continue;
    out.push({
      backend,
      kind: d.kind,
      reason: d.reason,
      secondsRemaining: Math.round((d.until - now) / 1000),
    });
  }
  return out;
}

export function resetBackendHealth(): void {
  store.down.clear();
}

// ── Telling the operator what to actually do ───────────────────────────────

/**
 * Turn a pile of backend failures into one instruction.
 *
 * The old aggregate message concatenated raw errors — the UI showed
 * `SerpAPI news 429: { "error": "Your account has run out of searches." }`,
 * which states a fact and asks the reader to work out the consequence. Five
 * sources each showing their own variant of that is how a single expired token
 * reads as five unrelated outages.
 *
 * This says which credential to touch. That is the only thing the reader can
 * act on, and no code change can substitute for it: with every search backend
 * down there is nothing left to search with.
 */
export function remedyFor(kinds: FailureKind[]): string {
  const set = new Set(kinds);
  const fixes: string[] = [];
  if (set.has("auth")) fixes.push("issue a fresh MUNSHOT_TOKEN (it is a session JWT and expires)");
  if (set.has("exhausted")) fixes.push("top up SERPAPI_KEY or set GOOGLE_API_KEY + GOOGLE_CX");
  if (fixes.length === 0) return "";
  return ` Fix: ${fixes.join(", or ")}.`;
}
