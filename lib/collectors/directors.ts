import { deslug, normaliseDin } from "../directorId";
import { cached } from "../searchCache";
import { searchWeb, type WebResult } from "./google";
import { searchBingForHost } from "./bing";
import { fetchWithTimeout, stripHtml } from "./types";

// ── Director identity resolution ───────────────────────────────────────────
// Turns a person's NAME into a person's IDENTITY: a DIN, and the companies
// they sit on. That is the whole accuracy story for director mode — a name
// search cannot tell three Rajesh Kumars apart, but a DIN is unique to one
// person and the company list gives every downstream sweep something to anchor
// on other than the spelling of a name.
//
// Same free public aggregator the company registry collector reads, for the
// same reason: MCA is authoritative but has no free API and blocks scraping.
// Director pages are keyed by DIN, which is exactly the key we need.
//
// Two depths, because the two callers want different things:
//   • resolveCandidates() — search results only. Fast and cheap enough to sit
//     behind the autocomplete, where it runs while the user is still typing.
//   • resolveIdentity()   — additionally fetches the profile page for the full
//     company list. Runs once per director run, before the sources fan out.
//
// Honest degradation throughout: an unresolvable name returns nothing and the
// run proceeds on the name alone, saying so. A guessed DIN would be worse than
// no DIN, so one is never invented.

const HOST = "tofler.in";
const CIN_RE = /[A-Z0-9]{21}/;

export interface DirectorCandidate {
  /** Canonical name as the registry record spells it. */
  name: string;
  /** The 8-digit DIN — the reason this module exists. */
  din: string;
  /** The profile page the record came from, for citation. */
  url: string;
  /** Companies the person is linked to. Populated from the profile page by
   *  resolveIdentity(); best-effort from search snippets otherwise. */
  companies: string[];
}

export interface DirectorQuery {
  name?: string;
  din?: string;
  anchorCompany?: string;
}

// ── Fast path: candidates from search results ──────────────────────────────

/**
 * Candidate directors matching a name or DIN, newest search first. No page
 * fetches — this runs per keystroke-burst behind the autocomplete, so it must
 * stay cheap. Results are cached (including empty ones) so a fast typist costs
 * one metered search, not one per character.
 */
export async function resolveCandidates(q: DirectorQuery): Promise<DirectorCandidate[]> {
  const query = searchQuery(q);
  if (!query) return [];
  return cached(`director:candidates:${query}`, async () => {
    const urls = await lookupUrls(query);
    const seen = new Set<string>();
    const out: DirectorCandidate[] = [];
    for (const r of urls) {
      const ref = parseDirectorUrl(r.url ?? "");
      if (!ref || seen.has(ref.din)) continue;
      seen.add(ref.din);
      out.push({
        name: nameFromResult(r, ref.slug),
        din: ref.din,
        url: ref.url,
        companies: companiesFromSnippet(r),
      });
    }
    return rank(out, q);
  });
}

/**
 * Put the person actually searched for first.
 *
 * A registry search for "Mukesh Ambani" returns every director whose name
 * contains those words — his children and his wife among them — and the search
 * engine has no reason to rank the one you meant above the rest. Nor does an
 * exact string match settle it: the register holds middle names, so the man
 * himself is on file as "Mukesh Dhirubhai Ambani" and matches no more exactly
 * than "Akash Mukesh Ambani" does.
 *
 * So: every word searched for must appear, then the searched first name should
 * be the candidate's first name, then the fewest extra words wins. Ranking
 * only — nothing is dropped, because a lower-ranked namesake may well be the
 * person meant, and the list is there for the user to choose from.
 */
function rank(candidates: DirectorCandidate[], q: DirectorQuery): DirectorCandidate[] {
  const wanted = tokens(q.name ?? "");
  if (wanted.length === 0) return candidates;

  const scored = candidates.map((c, i) => {
    const have = tokens(c.name);
    const hasAll = wanted.every((w) => have.includes(w));
    let score = 0;
    if (have.join(" ") === wanted.join(" ")) score = 3;
    else if (hasAll && have[0] === wanted[0]) score = 2;
    else if (hasAll) score = 1;
    // Fewer unsearched-for words is a closer match; `i` keeps the engine's own
    // ordering as the final tie-break rather than reshuffling equal candidates.
    return { c, score, extra: Math.max(0, have.length - wanted.length), i };
  });

  scored.sort((a, b) => b.score - a.score || a.extra - b.extra || a.i - b.i);
  return scored.map((s) => s.c);
}

function tokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter((t) => t.length > 1);
}

/**
 * The one query that finds a director page. A DIN is the sharper key, so it
 * wins outright when present.
 *
 * For a name, each word is quoted SEPARATELY rather than the whole name as one
 * phrase. The register records middle names, so the man everyone calls Mukesh
 * Ambani is filed as "Mukesh Dhirubhai Ambani" — and a phrase search for
 * "Mukesh Ambani" does not match his page at all, while it happily matches his
 * children's. Requiring both words without requiring adjacency finds him, and
 * `rank` then sorts him above the relatives. Initials are dropped: they are not
 * a constraint worth failing a lookup over.
 */
function searchQuery(q: DirectorQuery): string | null {
  const din = q.din ? normaliseDin(q.din) : undefined;
  if (din) return `site:${HOST} director "${din}"`;
  const name = (q.name ?? "").trim();
  if (name.length < 3) return null;
  const words = tokens(name).map((w) => `"${w}"`);
  if (words.length === 0) return null;
  const anchor = q.anchorCompany?.trim();
  return `site:${HOST} director ${words.join(" ")}${anchor ? ` "${anchor}"` : ""}`;
}

// The primary chain first — it is cached and already degrades across backends.
// Bing is the second opinion, so a rate-limited keyless engine doesn't cost us
// the lookup entirely. Mirrors what the company resolver does.
async function lookupUrls(query: string): Promise<WebResult[]> {
  try {
    const found = await searchWeb(query);
    if (found.length > 0) return found;
  } catch {
    /* fall through */
  }
  try {
    return (await searchBingForHost(query, HOST)).map((url) => ({ title: "", url }));
  } catch {
    return [];
  }
}

/**
 * A director profile URL, if this is one. Written against the shape rather
 * than a fixed path — the aggregator serves both /directors/<slug>/<DIN> and
 * /<slug>/director/<DIN>, and a URL scheme is not a thing to be brittle about.
 * The identifying marks are a "director" path segment and an 8-digit one.
 */
function parseDirectorUrl(raw: string): { url: string; din: string; slug: string } | null {
  if (!raw || !new RegExp(`${HOST.replace(".", "\\.")}/`, "i").test(raw)) return null;
  const path = raw.split(new RegExp(`${HOST.replace(".", "\\.")}/`, "i"))[1] ?? "";
  const segments = path.split(/[/?#]/).filter(Boolean);
  if (!segments.some((s) => /^directors?$/i.test(s))) return null;
  const din = segments.find((s) => /^\d{8}$/.test(s));
  if (!din) return null;
  // The name slug is the last non-numeric, non-keyword segment.
  const slug = [...segments].reverse().find((s) => !/^\d+$/.test(s) && !/^directors?$/i.test(s)) ?? "";
  return { url: raw.split(/[?#]/)[0], din, slug };
}

/** Prefer the record's own title over the URL slug, but only when the title
 *  actually reads like a name — aggregator titles are often decorated with
 *  "- Director Profile | Tofler" and similar. */
function nameFromResult(r: WebResult, slug: string): string {
  const head = (r.title ?? "").split(/[|–—:]|\s-\s/)[0].trim();
  const clean = head.replace(/\b(director|profile|din|tofler)\b/gi, "").replace(/\s{2,}/g, " ").trim();
  if (clean.length >= 3 && /^[\p{L}\s.'-]+$/u.test(clean)) return clean;
  return slug ? deslug(slug) : clean || "Unnamed director";
}

/** Companies named in a search snippet. Coarse by nature — the profile page is
 *  the real source — but it means the autocomplete can still show a company
 *  beside the name when the page itself can't be fetched. */
function companiesFromSnippet(r: WebResult): string[] {
  const snippet = r.snippet ?? "";
  if (!snippet) return [];
  const matches = snippet.match(
    /\b[A-Z][A-Za-z&.'-]*(?:\s+[A-Z][A-Za-z&.'-]*){0,5}\s+(?:Limited|Ltd|Private Limited|Pvt Ltd|LLP)\b/g,
  );
  return dedupe((matches ?? []).map((m) => m.trim())).slice(0, 5);
}

// ── Deep path: the profile page ────────────────────────────────────────────

/**
 * The identity a director run should be anchored to. Picks between namesakes
 * with the company the user supplied when there is one, then reads the profile
 * page for the full list of companies.
 *
 * Returns null when nothing resolves — the caller must carry on with the name
 * alone and say so, never with a guess.
 */
export async function resolveIdentity(
  q: DirectorQuery,
): Promise<{ chosen: DirectorCandidate; candidates: DirectorCandidate[]; ambiguous: boolean } | null> {
  const candidates = await resolveCandidates(q);
  if (candidates.length === 0) return null;

  const anchor = q.anchorCompany?.trim().toLowerCase();
  const anchored = anchor
    ? candidates.find((c) => c.companies.some((co) => co.toLowerCase().includes(anchor)))
    : undefined;

  // A DIN identifies one person, so a DIN-driven lookup is never ambiguous.
  // A name-driven one with several matches and nothing to separate them is.
  const chosen = anchored ?? candidates[0];
  const ambiguous = !q.din && !anchored && candidates.length > 1;

  const companies = await fetchCompanies(chosen.url).catch(() => []);
  return {
    chosen: { ...chosen, companies: companies.length > 0 ? companies : chosen.companies },
    candidates,
    ambiguous,
  };
}

/**
 * Companies on a director's profile page. Read from the links to company
 * records rather than from a table layout: every company a director is tied to
 * is an anchor to /<slug>/company/<CIN>, and that pattern survives a redesign
 * of the page around it. If none parse we return nothing and the caller
 * degrades — we do not fall back to guessing from the page text.
 */
export async function fetchCompanies(url: string): Promise<string[]> {
  return cached(`director:companies:${url}`, async () => {
    const res = await fetchWithTimeout(url, { timeoutMs: 20000, headers: { accept: "text/html" } });
    if (!res.ok) throw new Error(`profile ${res.status}`);
    const html = await res.text();
    const re = new RegExp(
      `<a[^>]+href="([^"]*/([a-z0-9-]+)/company/(${CIN_RE.source}))"[^>]*>([\\s\\S]*?)</a>`,
      "gi",
    );
    const names: string[] = [];
    for (const m of html.matchAll(re)) {
      const label = stripHtml(m[4]);
      names.push(label.length >= 3 ? label : deslug(m[2]));
    }
    return dedupe(names).slice(0, 25);
  });
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const key = v.toLowerCase();
    if (!v || seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}
