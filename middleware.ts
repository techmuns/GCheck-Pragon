import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// ── CORS for the hybrid deploy ─────────────────────────────────────────────
// The static UI (Cloudflare Pages) calls this backend cross-origin. Allow it.
// Lock the origin down with CORS_ALLOW_ORIGIN (e.g. https://app.pages.dev);
// defaults to "*". No cookies are used, so "*" is safe here.

const ALLOW_ORIGIN = process.env.CORS_ALLOW_ORIGIN || "*";

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": ALLOW_ORIGIN,
    "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
    // Authorization carries the Munshot session token the host hands the
    // dashboard. Without it here the preflight refuses every authenticated
    // call in the hybrid deploy, and the sources fall back to the environment
    // token as if the host had never sent one.
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

export function middleware(req: NextRequest) {
  // Preflight.
  if (req.method === "OPTIONS") {
    return new NextResponse(null, { status: 204, headers: corsHeaders() });
  }
  const res = NextResponse.next();
  for (const [k, v] of Object.entries(corsHeaders())) res.headers.set(k, v);
  return res;
}

export const config = { matcher: "/api/:path*" };
