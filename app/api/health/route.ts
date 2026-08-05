import { NextResponse } from "next/server";
import { backendChain } from "@/lib/collectors/google";
import { newsChain } from "@/lib/collectors/news";
import { readerChain } from "@/lib/collectors/reader";
import { hasOpenAI } from "@/lib/collectors/env";
import { tokenHealth } from "@/lib/tokenHealth";
import { cacheStats } from "@/lib/searchCache";
import { backendHealthSnapshot } from "@/lib/collectors/backendHealth";

export const dynamic = "force-dynamic";

// GET /api/health — search-credential status, for monitoring.
//
// Returns 503 when search is in (or heading into) a broken state, so an uptime
// checker or a cron can alert on the status code alone without parsing a body.
// Never echoes the token itself — only its expiry and the backends configured.
export async function GET() {
  const token = tokenHealth();
  const chain = backendChain();
  // What backends have actually been observed doing, as opposed to what the
  // token claims about itself: `tokenHealth` reads an expiry off the JWT and
  // knows nothing about a SerpAPI quota at all.
  const benched = backendHealthSnapshot();

  // Degraded, not failed: the token is dying but a durable backend will carry
  // search. Worth alerting on; not worth waking anyone at 3am.
  const degraded = token.state === "expiring" || (token.state !== "valid" && token.hasFallback) || benched.length > 0;

  // Every keyed backend is standing-failed. This is the case the old condition
  // could not see, and it is the one that actually happened: MUNSHOT_TOKEN
  // expired while SERPAPI_KEY was still *set* — so `hasFallback` was true, the
  // check reported 200/degraded, and every source in the run was dead. Having a
  // fallback configured is not the same as having one that answers.
  const keyed = chain.filter((b) => b !== "fallback");
  const allKeyedDown =
    keyed.length > 0 && keyed.every((b) => benched.some((x) => x.backend === b && x.kind !== "transient"));

  const broken = (!token.hasFallback && (token.state === "expired" || token.state === "absent")) || allKeyedDown;

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
        // Backends currently benched by the circuit breaker, with the failure
        // that benched them. This is the fastest answer to "why is everything
        // red and which credential do I touch" — it names the backend, says
        // whether the credential was rejected or the quota is spent, and gives
        // the seconds until it is re-probed.
        benched,
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
      // Lead with what is observably broken; the token's self-reported expiry
      // is the weaker signal and belongs behind it.
      message: benched.length > 0 ? `${benched.map((b) => `${b.backend}: ${b.reason}`).join(" | ")} — ${token.message}` : token.message,
    },
    { status: broken ? 503 : 200 },
  );
}
