import { NextResponse } from "next/server";
import { backendChain } from "@/lib/collectors/google";
import { tokenHealth } from "@/lib/tokenHealth";
import { cacheStats } from "@/lib/searchCache";

export const dynamic = "force-dynamic";

// GET /api/health — search-credential status, for monitoring.
//
// Returns 503 when search is in (or heading into) a broken state, so an uptime
// checker or a cron can alert on the status code alone without parsing a body.
// Never echoes the token itself — only its expiry and the backends configured.
export async function GET() {
  const token = tokenHealth();
  const chain = backendChain();

  // Degraded, not failed: the token is dying but a durable backend will carry
  // search. Worth alerting on; not worth waking anyone at 3am.
  const degraded = token.state === "expiring" || (token.state !== "valid" && token.hasFallback);
  // Broken: no working credential and nothing but the keyless engine behind it,
  // which is blocked from data-centre IPs.
  const broken = !token.hasFallback && (token.state === "expired" || token.state === "absent");

  return NextResponse.json(
    {
      ok: !broken,
      status: broken ? "broken" : degraded ? "degraded" : "ok",
      search: {
        backends: chain,
        primary: chain[0],
        hasDurableFallback: token.hasFallback,
        // Cache hits are metered calls not spent — the number to watch when
        // running on SerpAPI's free monthly quota.
        cache: cacheStats(),
      },
      munshotToken: {
        state: token.state,
        expiresAt: token.expiresAt,
        hoursRemaining: token.hoursRemaining,
      },
      message: token.message,
    },
    { status: broken ? 503 : 200 },
  );
}
