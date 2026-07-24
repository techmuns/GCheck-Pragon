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
    "Access-Control-Allow-Headers": "Content-Type",
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
