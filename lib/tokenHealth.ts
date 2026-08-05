import { env } from "./collectors/env";

// ── Search-credential health ───────────────────────────────────────────────
// MUNSHOT_TOKEN is a Munshot *user session* JWT, not a service key — it expires
// and takes web + news search with it unless a durable backend is configured.
// The expiry is readable from the token itself, so we can warn ahead of time
// instead of discovering it from a 403 mid-run.

export type TokenState = "absent" | "opaque" | "valid" | "expiring" | "expired";

export interface TokenHealth {
  state: TokenState;
  /** ISO expiry, when the token is a JWT that carries one. */
  expiresAt?: string;
  hoursRemaining?: number;
  /** A durable backend is configured, so an expiry degrades instead of breaking. */
  hasFallback: boolean;
  message: string;
}

/** Warn this far ahead of expiry. */
const WARN_HOURS = 48;

// Read `exp` out of a JWT payload without verifying the signature. We are not
// authenticating anything here — only reading the issuer's own stated expiry to
// decide whether to warn. Verification is the API's job.
function readExpiry(token: string): number | undefined {
  const parts = token.split(".");
  if (parts.length !== 3) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as { exp?: unknown };
    return typeof payload.exp === "number" ? payload.exp : undefined;
  } catch {
    return undefined;
  }
}

export function tokenHealth(now: number = Date.now()): TokenHealth {
  // Firecrawl counts: it answers searches as well as reading pages, so a deploy
  // holding only that key still degrades rather than going dark.
  const hasFallback = Boolean(env.serpApiKey || (env.googleApiKey && env.googleCx) || env.firecrawlApiKey);
  const token = env.munshotToken?.trim();

  if (!token) {
    return {
      state: "absent",
      hasFallback,
      message: hasFallback
        ? "MUNSHOT_TOKEN is not set. Search is running on the configured fallback backend; news search is limited."
        : "MUNSHOT_TOKEN is not set and no durable backend is configured — search will fall back to the keyless engine, which is blocked from most servers.",
    };
  }

  const exp = readExpiry(token);
  if (exp === undefined) {
    return {
      state: "opaque",
      hasFallback,
      message: "MUNSHOT_TOKEN is set but carries no readable expiry, so it cannot be checked ahead of time.",
    };
  }

  const expiresAt = new Date(exp * 1000).toISOString();
  const hoursRemaining = Math.round(((exp * 1000 - now) / 3_600_000) * 10) / 10;
  const cushion = hasFallback
    ? "Search will fall back to the configured Google backend, so it degrades rather than breaking."
    : "No fallback backend is configured, so search WILL break. Set SERPAPI_KEY or GOOGLE_API_KEY + GOOGLE_CX.";

  if (hoursRemaining <= 0) {
    return {
      state: "expired",
      expiresAt,
      hoursRemaining,
      hasFallback,
      message: `MUNSHOT_TOKEN expired at ${expiresAt}. ${cushion}`,
    };
  }

  if (hoursRemaining <= WARN_HOURS) {
    return {
      state: "expiring",
      expiresAt,
      hoursRemaining,
      hasFallback,
      message: `MUNSHOT_TOKEN expires in ${hoursRemaining}h (${expiresAt}). ${cushion}`,
    };
  }

  return {
    state: "valid",
    expiresAt,
    hoursRemaining,
    hasFallback,
    message: `MUNSHOT_TOKEN is valid for another ${hoursRemaining}h (expires ${expiresAt}).`,
  };
}
