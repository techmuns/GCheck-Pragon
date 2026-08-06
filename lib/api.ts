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

// ── Waking the backend before it is needed ─────────────────────────────────
// The engine runs on a host that sleeps when idle, and the first request after
// a sleep pays the whole cold start — which landed squarely on "Run
// pre-screen", the one click where the user is watching. So the app knocks on
// the backend the moment it loads, and again on a slow heartbeat while the tab
// stays open. By the time a company name has been typed the server is awake,
// and the POST that starts the run is a few hundred milliseconds instead of
// most of a minute.
//
// Deliberately fire-and-forget against the cheapest endpoint there is: nothing
// downstream may wait on it, and a failed warm-up must be invisible.

let warming = false;

export function warmBackend(): void {
  if (typeof window === "undefined" || warming) return;
  warming = true;
  void fetch(apiUrl("/api/health"), { method: "GET", cache: "no-store", keepalive: true })
    .catch(() => {})
    .finally(() => {
      warming = false;
    });
}

/** Keep it awake while the dashboard is open. Returns an unsubscribe. */
export function keepBackendWarm(intervalMs = 10 * 60 * 1000): () => void {
  if (typeof window === "undefined") return () => {};
  warmBackend();
  const id = setInterval(() => {
    // Only while the tab is actually being looked at — a backgrounded tab
    // holding a server awake is someone else's bill.
    if (document.visibilityState === "visible") warmBackend();
  }, intervalMs);
  // Coming back to a tab left open for an hour is exactly when the server has
  // gone to sleep again.
  const onVisible = () => {
    if (document.visibilityState === "visible") warmBackend();
  };
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    clearInterval(id);
    document.removeEventListener("visibilitychange", onVisible);
  };
}
