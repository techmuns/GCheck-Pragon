import type { CollectorResult, ExcludedItem, RunEventLevel, Subject } from "../types";

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

// ── What a sweep chose not to use ──────────────────────────────────────────
// A relevance filter that drops what it rejects leaves the reader unable to
// tell a search that found nothing from one that found things and set them
// aside — and about a person those are very different statements. Keeping a
// bounded sample, with the reason, is what lets the brief say "this came up,
// and here is why it is not held against them".

/** How many set-aside items one source keeps. Enough to show what was
 *  considered; few enough that the record cannot become a second report. */
export const MAX_EXCLUDED = 6;

/** Record an item the sweep deliberately did not use, while there is room. */
export function noteExcluded(
  into: ExcludedItem[],
  item: { title?: string; url?: string; reason: string },
): void {
  const title = item.title?.trim();
  if (!title || into.length >= MAX_EXCLUDED) return;
  if (into.some((e) => e.title === title)) return;
  into.push({ title, url: item.url, reason: item.reason });
}

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

/**
 * A stable key for "the same article".
 *
 * Tracking parameters, a fragment or a trailing slash are enough to make one
 * story look like several — and it arrives from several places, because a
 * news engine and a web engine both index the publisher. Deduping on the raw
 * URL counted those separately, which inflated the coverage and could send the
 * same page to the reader twice.
 */
export function canonicalUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    u.hash = "";
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|mc_|ref$|source$)/i.test(key)) u.searchParams.delete(key);
    }
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
    u.protocol = "https:";
    const path = u.pathname.replace(/\/+$/, "");
    return `${u.hostname}${path}${u.search}`;
  } catch {
    return url.trim().toLowerCase() || undefined;
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
