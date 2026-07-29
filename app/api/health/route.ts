import { NextResponse } from "next/server";
import { backendChain } from "@/lib/collectors/google";
import { newsChain } from "@/lib/collectors/news";
import { readerChain } from "@/lib/collectors/reader";
import { hasOpenAI } from "@/lib/collectors/env";
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
      // News and article reading ride the same session token as web search, so
      // its expiry costs more than it used to. Reported separately because they
      // degrade differently: news falls back to SerpAPI, reading to Firecrawl,
      // and reading has no keyless mode at all — without it the brief is written
      // from headlines and cannot say who brought a complaint.
      news: { backends: newsChain(), configured: newsChain().length > 0 },
      reader: {
        backends: readerChain(),
        configured: readerChain().length > 0,
        // Reading an article is a fetch AND an extraction; one without the
        // other reads pages it cannot turn into findings.
        extraction: hasOpenAI(),
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
