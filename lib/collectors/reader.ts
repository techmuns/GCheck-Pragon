import { env } from "./env";
import { canonicalUrl, fetchWithTimeout, stripHtml } from "./types";
import { backendFailure, withRetry } from "./google";
import { cached } from "../searchCache";
import { classifyError, noteBackendFailure, noteBackendSuccess, planAttempts } from "./backendHealth";

// ── Article reader ──────────────────────────────────────────────────────────
// A headline says that a matter exists. Only the body says what it was, who the
// authority was, what was actually alleged — and, decisively, which side of it
// the subject was on. "Saarthi raises allegations against Classplus" and
// "allegations raised against Saarthi" are the same nine words to a keyword
// matcher and opposite facts to a partner.
//
// Two backends, chained the way the search backends are: Muns first because it
// reuses a token we already hold, Firecrawl behind it for the publishers Muns
// cannot open. No keyless option — fetching arbitrary news HTML and regexing it
// produces confident nonsense, and confident nonsense is worse here than an
// honest "could not open this".

/** Read timeouts are generous: a reader fetches and renders a page. */
const READ_TIMEOUT_MS = 45000;
/** How many URLs to hand Muns per call. */
const BATCH = 5;
/** Enough of an article to carry the facts; short enough to stay cheap. */
const MAX_CHARS = 20000;

export type ReaderBackend = "munshot" | "firecrawl";

export interface Article {
  url: string;
  text: string;
  title?: string;
  readBy: ReaderBackend;
}

export function readerChain(): ReaderBackend[] {
  const chain: ReaderBackend[] = [];
  if (env.munshotToken) chain.push("munshot");
  if (env.firecrawlApiKey) chain.push("firecrawl");
  return chain;
}

/**
 * Open each URL and return what could be read.
 *
 * A URL that cannot be opened is simply absent from the result — never an
 * empty article, which would read downstream as "we looked and there was
 * nothing in it". Callers report the gap from the count.
 */
export async function readArticles(
  urls: string[],
  task: string,
  emit?: (text: string, meta?: { url?: string; level?: "fetch" | "warn" | "cache" }) => void,
): Promise<Article[]> {
  const chain = readerChain();
  if (chain.length === 0 || urls.length === 0) return [];

  const wanted = [...new Set(urls.filter(Boolean))];
  const out: Article[] = [];

  for (let i = 0; i < wanted.length; i += BATCH) {
    const batch = wanted.slice(i, i + BATCH);
    for (const url of batch) emit?.(`Opening ${hostOf(url)}`, { url, level: "fetch" });

    let read: Article[] = [];
    let failure: string | undefined;
    // The reader rides the same MUNSHOT_TOKEN as web and news search, so when
    // that token is rejected it is rejected here too. Honouring the shared
    // breaker means a dead token found by the search sweep sends reading
    // straight to Firecrawl, instead of every batch paying for its own 403 —
    // and with a read cap of 8 that was up to 8 doomed calls a run, each one
    // retried, on the slowest timeout in the codebase.
    const plan = planAttempts(chain);
    if (plan.attempt.length === 0) {
      emit?.(`No reader available — ${plan.knownFailures.join(" / ")}`, { level: "warn" });
      break;
    }
    for (const backend of plan.attempt) {
      try {
        read = await readWith(backend, batch, task);
        noteBackendSuccess(backend);
        if (read.length > 0) break;
      } catch (err) {
        failure = err instanceof Error ? err.message : String(err);
        noteBackendFailure(backend, classifyError(err), failure);
        // Say which backend stepped aside and why — a silent fallback looks
        // identical to an article that had nothing in it.
        emit?.(`${backend} could not read this batch (${failure}) — trying the next reader`, { level: "warn" });
      }
    }

    out.push(...read);

    const missed = batch.filter((u) => !read.some((a) => canonicalUrl(a.url) === canonicalUrl(u)));
    for (const url of missed) {
      emit?.(`Could not open ${hostOf(url)}${failure ? ` — ${failure}` : ""}`, { url, level: "warn" });
    }
  }

  return out;
}

async function readWith(backend: ReaderBackend, urls: string[], task: string): Promise<Article[]> {
  if (backend === "munshot") return readMunshot(urls, task);
  // Firecrawl takes one URL per call, so it is the slow path and only ever the
  // fallback. A single failure there costs one article, not the batch.
  const results = await Promise.all(urls.map((u) => readFirecrawl(u).catch(() => null)));
  return results.filter((a): a is Article => a !== null);
}

// Muns web-reader: POST { urls, task }. `task` steers the extraction, which is
// what makes a batched read still article-specific.
async function readMunshot(urls: string[], task: string): Promise<Article[]> {
  const key = `read:munshot:${urls.map((u) => canonicalUrl(u)).join("|")}:${hash(task)}`;
  return cached(key, async () =>
    withRetry(async () => {
      const res = await fetchWithTimeout(env.munshotReaderUrl, {
        method: "POST",
        timeoutMs: READ_TIMEOUT_MS,
        headers: {
          "Content-Type": "application/json",
          accept: "application/json",
          Authorization: `Bearer ${env.munshotToken}`,
        },
        body: JSON.stringify({ urls, task }),
      });
      if (!res.ok) throw await backendFailure("munshot", "Munshot reader", res);
      return parseReader(await res.json(), urls, "munshot");
    }),
  );
}

async function readFirecrawl(url: string): Promise<Article | null> {
  return cached(`read:firecrawl:${canonicalUrl(url)}`, async () => {
    const res = await fetchWithTimeout(env.firecrawlUrl, {
      method: "POST",
      timeoutMs: READ_TIMEOUT_MS,
      headers: {
        "Content-Type": "application/json",
        accept: "application/json",
        Authorization: `Bearer ${env.firecrawlApiKey}`,
      },
      body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
    });
    if (!res.ok) throw await backendFailure("firecrawl", "Firecrawl", res);
    const data = (await res.json()) as { data?: { markdown?: string; metadata?: { title?: string } } };
    const text = clean(data.data?.markdown ?? "");
    if (!text) return null;
    return { url, text, title: data.data?.metadata?.title, readBy: "firecrawl" as const };
  });
}

/**
 * The reader can answer in several shapes and has changed them before, so every
 * plausible one is handled rather than the one seen most recently: a list of
 * results, a `{data: …}` envelope, or a bare `{url: content}` map.
 */
function parseReader(data: unknown, urls: string[], readBy: ReaderBackend): Article[] {
  const out: Article[] = [];

  const take = (url: string | undefined, content: unknown, title?: unknown) => {
    const text = clean(typeof content === "string" ? content : "");
    if (!url || !text) return;
    out.push({ url, text, title: typeof title === "string" ? title : undefined, readBy });
  };

  const walk = (node: unknown): void => {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (typeof node !== "object") return;
    const o = node as Record<string, unknown>;

    if (o.data !== undefined && o.url === undefined) return walk(o.data);
    if (Array.isArray(o.results)) return walk(o.results);

    const content = o.content ?? o.text ?? o.markdown ?? o.body ?? o.extracted;
    if (content !== undefined) {
      take(typeof o.url === "string" ? o.url : urls[out.length], content, o.title);
      return;
    }

    // A bare { url: content } map — the keys are the URLs.
    for (const [k, v] of Object.entries(o)) {
      if (/^https?:\/\//i.test(k)) take(k, v);
    }
  };

  walk(data);
  return out;
}

function clean(raw: string): string {
  const text = /<[a-z][\s\S]*>/i.test(raw) ? stripHtml(raw) : raw.replace(/\s+\n/g, "\n").trim();
  return text.slice(0, MAX_CHARS);
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** A short, stable key fragment for a prompt, so two different tasks over the
 *  same URLs do not share a cache entry. */
function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}
