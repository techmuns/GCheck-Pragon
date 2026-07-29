import { fetchWithTimeout } from "./types";

// ── Keyless second-opinion search ──────────────────────────────────────────
// A minimal Bing HTML scrape, used only to recover links on a specific host
// when the primary search chain is rate-limited or down. Never a primary
// source: it exists so one throttled engine can't sink a registry lookup.

/** Links on `host` that Bing returns for `query`. Empty rather than throwing
 *  when the page comes back in an unexpected shape — the caller already has a
 *  degradation path and an empty list travels it correctly. */
export async function searchBingForHost(query: string, host: string): Promise<string[]> {
  const res = await fetchWithTimeout(`https://www.bing.com/search?q=${encodeURIComponent(query)}`, {
    timeoutMs: 15000,
    headers: { accept: "text/html" },
  });
  if (!res.ok) throw new Error(`Bing ${res.status}`);
  const html = await res.text();
  const re = new RegExp(`href="(https?://[^"]*${host.replace(/\./g, "\\.")}/[^"]+)"`, "gi");
  return [...html.matchAll(re)].map((m) => m[1]);
}
