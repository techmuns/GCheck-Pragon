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

// ── Auth ───────────────────────────────────────────────────────────────────
// Every call to this app's API carries the Munshot session token the host hands
// the dashboard (hooks/useHostContext). The backend prefers it over the
// environment's MUNSHOT_TOKEN for the Munshot-backed sources, so the run is
// authenticated as the person actually using the dashboard rather than by a
// static session JWT that expires.
//
// A null token is left off entirely rather than sent as "Bearer null": outside
// the host there is no session to forward, and the backend should fall through
// to its own credential instead of being handed one it will only reject.

export function authHeaders(token: string | null | undefined): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** `authHeaders` plus a JSON content type, for the calls that send a body. */
export function jsonAuthHeaders(token: string | null | undefined): Record<string, string> {
  return { "Content-Type": "application/json", ...authHeaders(token) };
}
