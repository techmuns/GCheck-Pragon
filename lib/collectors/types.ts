import type { CollectorResult, RunEventLevel, Subject } from "../types";

// ── Collector contract ─────────────────────────────────────────────────────
// Every source implements a Collector: given the subject + enabled keywords, it
// returns raw hits, or an honest skipped/error result with a reason. Collectors
// never fabricate — an absent credential yields `status: "skipped"`, not fake data.

export interface CollectorContext {
  subject: Subject;
  /** Enabled red-flag keywords. */
  keywords: string[];
  /**
   * Narrate a step to the run's activity log, as it happens.
   *
   * Optional so a collector can ignore it and still satisfy the contract, and
   * deliberately fire-and-forget: a collector's job is to collect, and a
   * failure to describe itself must never be able to fail the collection.
   */
  emit?: (text: string, meta?: { url?: string; level?: RunEventLevel }) => void;
}

export type Collector = (ctx: CollectorContext) => Promise<CollectorResult>;

// ── Shared HTTP helper ─────────────────────────────────────────────────────
// A fetch with a hard timeout and a browser-like UA, so a slow or hanging
// source can't stall the whole run.

export async function fetchWithTimeout(
  url: string,
  opts: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = 12000, ...init } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        ...(init.headers ?? {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Strip HTML tags and collapse whitespace from a snippet. */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}
