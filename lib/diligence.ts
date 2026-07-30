import type {
  AppConfig,
  CollectorResult,
  DiligenceFinding,
  Finding,
  PersonDiligence,
  Subject,
} from "./types";
import { collectors, type CollectorContext } from "./collectors";
import { assembleBrief } from "./assemble";
import { resolveDirector, anchorNames } from "./collectors/indiafilings";
import { compareByHierarchy, seniorRole, type RankablePerson } from "./hierarchy";
import { nameFromTitle } from "./people";
import { normaliseDin } from "./directorId";
import { cleanFindingText, titleCaseName } from "./text";

// ── Board diligence ──────────────────────────────────────────────────────────
// Running a company is not the same as running its people. The company brief
// lists the board; this puts each director through their own focused pre-screen
// and streams the verdicts back one at a time.
//
// Two principles carry over from the rest of the app, and they are the whole
// reason this can be trusted:
//
//   • Namesake safety. A director is checked by their DIN, not the spelling of
//     their name: their registry record supplies the companies that ANCHOR every
//     search, so a case naming some other Arun Misra is graded "unverified" and
//     never charged to this one. The reduction reuses assembleBrief, so it
//     inherits that grading wholesale.
//   • It can never break the run. Every person is deadlined and wrapped; a
//     person whose checks fail becomes a "couldn't complete" card, never an
//     exception that strands the company brief that already shipped.

/** Which sources each director is screened against. Kept lighter than a full
 *  director run — this fans out across a whole board — but every one of these is
 *  a real risk signal: the register (other directorships + standing), the web
 *  red-flag sweep, and litigation. Widen it with DILIGENCE_SOURCES for a deeper,
 *  slower run (e.g. add `news,profile`). */
function diligenceSources(): string[] {
  const raw = (process.env.DILIGENCE_SOURCES ?? "").trim();
  if (raw) return raw.split(",").map((s) => s.trim()).filter(Boolean);
  return ["indiafilings", "google", "indiankanoon"];
}

function maxPeople(): number {
  const n = Number(process.env.DILIGENCE_MAX_PEOPLE);
  return Number.isFinite(n) && n > 0 ? n : 10;
}
function concurrency(): number {
  const n = Number(process.env.DILIGENCE_CONCURRENCY);
  return Number.isFinite(n) && n > 0 ? n : 3;
}
function personDeadlineMs(): number {
  const n = Number(process.env.DILIGENCE_PERSON_DEADLINE_SECONDS);
  return (Number.isFinite(n) && n > 0 ? n : 120) * 1000;
}

/** Diligence is company-only, and can be switched off entirely. */
export function diligenceEnabled(subject: Subject): boolean {
  if (subject.type === "director") return false;
  return (process.env.ENABLE_BOARD_DILIGENCE ?? "true").toLowerCase() !== "false";
}

interface Seed {
  name: string;
  din?: string;
  role?: string;
  tenure?: string;
}

function str(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s.length > 0 ? s : undefined;
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * The people to run, richest-source-first and ordered by office.
 *
 * Taken from the same registry director rows the Key People list is built from,
 * deduped on DIN (the one identifier a namesake cannot share), plus any
 * promoters the user named. Ordered by seniority so a truncated board keeps the
 * Managing Director, not the fifth independent director.
 */
export function extractBoard(collected: CollectorResult[], subject: Subject): Seed[] {
  const byKey = new Map<string, Seed & RankablePerson>();
  const add = (s: Seed) => {
    const din = normaliseDin(s.din ?? "");
    const key = din ? `din:${din}` : `name:${s.name.toLowerCase()}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...s, din: din || s.din });
      return;
    }
    existing.din ??= din || s.din;
    existing.tenure ??= s.tenure;
    existing.role = seniorRole(existing.role, s.role);
  };

  for (const sid of ["indiafilings", "registry"]) {
    const c = collected.find((x) => x.sourceId === sid);
    if (c?.status !== "done") continue;
    for (const h of c.hits) {
      if (h.extra?.category !== "director") continue;
      const name = str(h.extra?.name) ?? nameFromTitle(h.title);
      if (!name) continue;
      add({
        name,
        din: str(h.extra?.din),
        role: str(h.extra?.designation) ?? str(h.extra?.role),
        tenure: str(h.extra?.tenure),
      });
    }
  }

  // Promoters the user named ride alongside the board.
  for (const p of subject.promoters) {
    if (p.trim()) add({ name: p.trim(), role: "Promoter" });
  }

  return [...byKey.values()].sort(compareByHierarchy);
}

/**
 * Run every director's diligence, streaming each result as it lands.
 *
 * `onUpdate` is called with the whole people array every time one changes state,
 * so the caller can publish it straight onto the run — the board fills with
 * verdicts live rather than all at once at the end.
 */
export async function runBoardDiligence(
  subject: Subject,
  collected: CollectorResult[],
  config: AppConfig,
  hooks: { emit?: (text: string) => void; onUpdate?: (people: PersonDiligence[]) => void },
): Promise<PersonDiligence[]> {
  const seeds = extractBoard(collected, subject).slice(0, maxPeople());
  if (seeds.length === 0) return [];

  const people: PersonDiligence[] = seeds.map((s) => ({
    id: s.din ? `din:${normaliseDin(s.din)}` : `name:${slug(s.name)}`,
    name: s.name,
    din: s.din ? normaliseDin(s.din) : undefined,
    role: s.role,
    tenure: s.tenure,
    status: "pending",
    concerns: [],
    otherDirectorships: [],
  }));
  const publish = () => hooks.onUpdate?.(people.map((p) => ({ ...p })));

  hooks.emit?.(`Screening ${people.length} director(s) individually`);
  publish();

  let completed = 0;
  await mapPool(seeds, concurrency(), async (seed, i) => {
    people[i].status = "running";
    publish();
    try {
      const result = await withDeadline(
        diligenceOne(seed, subject.company, config),
        `Diligence for ${seed.name}`,
        personDeadlineMs(),
      );
      people[i] = { ...people[i], ...result, status: "done" };
    } catch (err) {
      people[i] = {
        ...people[i],
        status: "error",
        note: `Could not complete this check — ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    completed += 1;
    const v = people[i].verdict;
    hooks.emit?.(
      `Director ${completed}/${people.length}: ${people[i].name}` +
        (people[i].status === "error"
          ? " — could not complete"
          : v === "red"
            ? " — RED FLAG"
            : v === "amber"
              ? ` — ${people[i].concerns.length} to review`
              : " — nothing adverse"),
    );
    publish();
  });

  return people;
}

/** Screen one director and reduce their mini-brief to a diligence card. */
async function diligenceOne(seed: Seed, companyName: string, config: AppConfig): Promise<Partial<PersonDiligence>> {
  // Settle identity first, so every search is anchored to the companies this
  // person actually sits on — that is what tells their record from a namesake's.
  let din = seed.din ? normaliseDin(seed.din) : undefined;
  let resolvedName = seed.name;
  const anchors = new Set<string>([companyName]);
  let companies: Array<{ name: string; status?: string }> | undefined;
  try {
    const record = await withDeadline(
      resolveDirector({ din, name: seed.name, anchorCompany: companyName }),
      `Registry record for ${seed.name}`,
      45000,
    );
    if (record) {
      din = record.din || din;
      resolvedName = record.name || seed.name;
      for (const a of anchorNames(record)) anchors.add(a);
      // Structured company list, for the board's relationship network. Kept
      // separate from the rendered directorship lines so the graph works on
      // names and statuses rather than parsing display strings.
      companies = record.entities.map((e) => ({ name: e.name, status: e.status }));
    }
  } catch {
    // No registry record — fall through on the name and the parent company
    // alone. assembleBrief will mark everything name-matched, so nothing is
    // charged to this person that cannot be tied to them.
  }

  const directorSubject: Subject = {
    type: "director",
    company: resolvedName,
    promoters: [],
    din,
    anchors: [...anchors],
  };

  const collected = await runSources(directorSubject, diligenceSources(), config);
  const brief = assembleBrief(directorSubject, collected, config);
  const urlByRef = new Map(brief.citations.filter((c) => c.url).map((c) => [c.ref, c.url as string]));
  // The card is already titled with this person's name and the register writes
  // in capitals, so the raw finding — "PANKAJ KUMAR VERMA: "SOME CO LIMITED" —
  // matched legal." — is mostly noise repeated once per row. Cleaned here, at
  // the source, so the screen and the exported report agree.
  const shownName = titleCaseName(resolvedName) || resolvedName;
  const link = (f: Finding): DiligenceFinding => ({
    severity: f.severity,
    text: cleanFindingText(f.text, resolvedName).split(resolvedName).join(shownName),
    url: f.sourceRef !== undefined ? urlByRef.get(f.sourceRef) : undefined,
  });

  const summary = brief.sections.find((s) => s.id === "red-flags");
  const concerns = (summary?.findings ?? [])
    .filter((f) => f.severity === "red" || f.severity === "amber")
    .slice(0, 5)
    .map(link);

  const directorships = (brief.sections.find((s) => s.id === "directorships")?.findings ?? [])
    .filter((f) => f.severity !== "clear")
    .slice(0, 8)
    .map(link);

  return {
    din,
    name: shownName,
    verdict: brief.verdict,
    headline: cleanFindingText(brief.headline, resolvedName).split(resolvedName).join(shownName),
    concerns,
    otherDirectorships: directorships,
    companies: companies?.map((c) => ({ name: titleCaseName(c.name) || c.name, status: c.status })),
    note: din ? undefined : "No unique registry record matched this name — findings are name-matched only.",
  };
}

// ── Running a subset of collectors for one subject ───────────────────────────

async function runSources(subject: Subject, sourceIds: string[], config: AppConfig): Promise<CollectorResult[]> {
  const keywords = config.keywords.filter((k) => k.enabled).map((k) => k.term);
  const results = await Promise.all(
    sourceIds.map(async (id): Promise<CollectorResult> => {
      const source = config.sources.find((s) => s.id === id);
      const collector = collectors[id];
      const name = source?.name ?? id;
      const base = { sourceId: id, sourceName: name, kind: source?.kind ?? ("api" as const) };
      if (!source || source.locked || !collector) {
        return { ...base, status: "skipped", note: "Not run in diligence mode.", hits: [] };
      }
      // Deliberately quiet — a whole board's worth of per-source chatter would
      // bury the person-level progress the log is trying to show.
      const ctx: CollectorContext = { subject, keywords };
      try {
        return await withDeadline(collector(ctx), name, personDeadlineMs());
      } catch (err) {
        return { ...base, status: "error", note: err instanceof Error ? err.message : String(err), hits: [] };
      }
    }),
  );
  return results;
}

// ── Small concurrency + deadline helpers ─────────────────────────────────────

/** Run `fn` over `items` with at most `limit` in flight, preserving index. */
async function mapPool<T>(items: T[], limit: number, fn: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
}

/** Resolve with the work, or reject once the deadline passes. */
function withDeadline<T>(work: Promise<T>, label: string, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} did not respond within ${Math.round(ms / 1000)}s`)), ms);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer)) as Promise<T>;
}
