// ── API base ───────────────────────────────────────────────────────────────
// In the all-in-one deploy this is empty (same origin). In the hybrid deploy
// (static UI on Cloudflare Pages + backend on a Node host) set
// NEXT_PUBLIC_API_BASE to the backend URL at build time, e.g.
//   NEXT_PUBLIC_API_BASE=https://paragon-api.onrender.com
// It is inlined into the client bundle by Next at build.

export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE ?? "").replace(/\/$/, "");

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}
