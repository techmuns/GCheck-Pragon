import {
  ARCHIVE_VERSION,
  byteLength,
  entryFromRun,
  entryFromStart,
  errorEntry,
  finishEntry,
  snapshotRun,
  unknownEntry,
  type ArchiveEntry,
  type ArchivedRun,
  type StartInput,
} from "./archive";
import { getRecentSearches } from "./history";
import type { Run } from "./types";

// ── Where the history is actually kept ───────────────────────────────────────
// In this browser, on this device. Nowhere else, and that is a decision rather
// than an omission: the server's run store is a `globalThis` Map (lib/store.ts)
// that a redeploy wipes, the free instance has no persistent disk, and the
// static-export build ships the UI with no API origin at all. There is no
// durable server tier to write to without adding a database, so the record that
// survives is the one the browser holds.
//
// It is held in two places, for two different reasons:
//
//   localStorage  the index — one small row per run. Synchronous, so the search
//                 form can read its recent list without a loading state, and
//                 small enough that hundreds of runs cost well under a
//                 megabyte. This is what "history" means; it is not thrown away.
//   IndexedDB     the saved briefs. Tens of kilobytes each, so they cannot live
//                 in the 5 MB localStorage quota alongside the index without
//                 eventually taking it down with them. These are a rolling
//                 window: when the budget is reached the oldest copies go and
//                 their rows say so, plainly, rather than offering a button
//                 that opens nothing.
//
// Every accessor guards on `typeof window` and swallows its own failures — the
// house rule from lib/history.ts. History is a record, not a transaction: it
// must never be the reason a run fails to start.

export const INDEX_KEY = "paragon.runHistory.v1";
/** Written once the legacy recent-search list has been carried across, so
 *  "Clear all" cannot be quietly undone by re-importing it on the next load. */
const MIGRATED_KEY = "paragon.runHistory.migrated";

const MAX_ENTRIES = 500;
const MAX_INDEX_BYTES = 512 * 1024;

const DB_NAME = "paragon";
const DB_VERSION = 1;
const STORE = "runs";
const MAX_BODIES = 120;
const MAX_BODY_BYTES = 40 * 1024 * 1024;

// ── The index ───────────────────────────────────────────────────────────────
// Held in memory and flushed on a microtask. A board sweep starts a dozen runs
// inside one click handler; writing the whole array to localStorage twelve times
// in that tick is visible jank on the exact gesture this feature exists to make
// cheap.

let cache: ArchiveEntry[] | null = null;
/** Ids deleted here, so a merge with another tab's copy cannot resurrect them. */
const tombstones = new Set<string>();
let flushQueued = false;

const listeners = new Set<(entries: ArchiveEntry[]) => void>();

function valid(r: unknown): r is ArchiveEntry {
  const e = r as ArchiveEntry | null;
  return (
    typeof e?.id === "string" &&
    typeof e?.company === "string" &&
    Array.isArray(e?.promoters) &&
    typeof e?.startedAt === "string" &&
    Number.isFinite(Date.parse(e.startedAt))
  );
}

function newestFirst(a: ArchiveEntry, b: ArchiveEntry): number {
  return Date.parse(b.startedAt) - Date.parse(a.startedAt);
}

function parseIndex(raw: string | null): ArchiveEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    // An envelope from day one, so a future shape change is an upgrade rather
    // than a second key and an orphaned first one. A bare array is tolerated in
    // case anything ever wrote one.
    const rows = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { entries?: unknown })?.entries)
        ? (parsed as { entries: unknown[] }).entries
        : [];
    return rows.filter(valid).sort(newestFirst);
  } catch {
    return [];
  }
}

/** Carry the old five-item recent list across, once, so an upgrade does not
 *  look like a wipe. The rows have a timestamp and a subject and nothing else,
 *  which is exactly what they are shown as. */
function migrate(): ArchiveEntry[] {
  if (window.localStorage.getItem(MIGRATED_KEY)) return [];
  const out: ArchiveEntry[] = [];
  try {
    getRecentSearches().forEach((r, i) => {
      if (!Number.isFinite(Date.parse(r.at))) return;
      out.push({
        id: `legacy-${i}-${Date.parse(r.at)}`,
        showInRecent: true,
        rawQuery: r.company,
        type: r.type ?? "company",
        company: r.company,
        promoters: r.promoters,
        startedAt: r.at,
        outcome: "unknown",
        red: 0,
        amber: 0,
        sourcesDone: 0,
        sourcesTotal: 0,
        hasBody: false,
        bytes: 0,
      });
    });
    window.localStorage.setItem(MIGRATED_KEY, "1");
  } catch {
    /* best effort — a failed migration must not block history itself */
  }
  return out;
}

function load(): ArchiveEntry[] {
  if (typeof window === "undefined") return [];
  const stored = parseIndex(window.localStorage.getItem(INDEX_KEY));
  if (stored.length > 0) {
    // Still mark the migration done, so a browser that already carried its
    // legacy rows across cannot re-import them after a "Clear all".
    try {
      if (!window.localStorage.getItem(MIGRATED_KEY)) window.localStorage.setItem(MIGRATED_KEY, "1");
    } catch {
      /* ignore */
    }
    return stored;
  }
  const migrated = migrate();
  return migrated.length > 0 ? migrated.sort(newestFirst) : stored;
}

export function readHistory(): ArchiveEntry[] {
  if (typeof window === "undefined") return [];
  if (cache === null) cache = load();
  return cache;
}

function emit(): void {
  const snapshot = cache ?? [];
  for (const fn of listeners) {
    try {
      fn(snapshot);
    } catch {
      /* a listener that throws must not stop the others */
    }
  }
}

function write(entries: ArchiveEntry[]): void {
  const payload = JSON.stringify({ v: ARCHIVE_VERSION, entries });
  try {
    window.localStorage.setItem(INDEX_KEY, payload);
  } catch {
    // Out of room. Drop the oldest half and try once more; if that fails the
    // index stays as it was on disk, which is worse than the truth but never
    // an exception thrown at whatever was recording a run.
    const half = entries.slice(0, Math.max(1, Math.floor(entries.length / 2)));
    try {
      window.localStorage.setItem(INDEX_KEY, JSON.stringify({ v: ARCHIVE_VERSION, entries: half }));
      cache = half;
    } catch {
      /* give up quietly */
    }
  }
}

function flush(): void {
  if (typeof window === "undefined" || cache === null) return;

  // Merge with whatever is on disk before writing. Two tabs both hold the whole
  // array, so a plain overwrite would silently drop a run the other one just
  // finished. Ours wins per id; anything we deleted stays deleted.
  const disk = parseIndex(window.localStorage.getItem(INDEX_KEY));
  const byId = new Map<string, ArchiveEntry>();
  for (const e of disk) if (!tombstones.has(e.id)) byId.set(e.id, e);
  for (const e of cache) byId.set(e.id, e);

  let merged = [...byId.values()].sort(newestFirst).slice(0, MAX_ENTRIES);
  while (merged.length > 1 && byteLength(merged) > MAX_INDEX_BYTES) {
    merged = merged.slice(0, Math.max(1, merged.length - 25));
  }

  cache = merged;
  write(merged);
}

function commit(next: ArchiveEntry[]): void {
  cache = next.sort(newestFirst);
  emit();
  if (typeof window === "undefined" || flushQueued) return;
  flushQueued = true;
  queueMicrotask(() => {
    flushQueued = false;
    flush();
  });
}

/** Read-modify-write against the in-memory index. */
function mutate(fn: (entries: ArchiveEntry[]) => ArchiveEntry[]): void {
  if (typeof window === "undefined") return;
  commit(fn([...readHistory()]));
}

function upsert(entries: ArchiveEntry[], entry: ArchiveEntry): ArchiveEntry[] {
  const at = entries.findIndex((e) => e.id === entry.id);
  if (at < 0) return [entry, ...entries];
  const next = [...entries];
  next[at] = entry;
  return next;
}

function patch(id: string, fn: (prev: ArchiveEntry) => ArchiveEntry): void {
  mutate((entries) => {
    const at = entries.findIndex((e) => e.id === id);
    if (at < 0) return entries;
    const next = [...entries];
    next[at] = fn(next[at]);
    return next;
  });
}

export function subscribeHistory(fn: (entries: ArchiveEntry[]) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Another tab wrote the index. Adopt it rather than fighting over it. */
function onStorage(e: StorageEvent): void {
  if (e.key !== INDEX_KEY) return;
  cache = parseIndex(e.newValue);
  emit();
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", onStorage);
}

// ── The saved briefs ────────────────────────────────────────────────────────
// A hand-rolled IndexedDB wrapper — fifty lines against a dependency, and every
// path resolves to the empty value rather than rejecting. A browser with
// IndexedDB refused (Safari's private mode, a locked-down profile) must fall
// back to an index-only history where "Run again" still works, not to a dead
// button or a thrown error.

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (typeof window === "undefined" || !("indexedDB" in window)) return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    try {
      const req = window.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest, fallback: T): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve) => {
        if (!db) return resolve(fallback);
        try {
          const t = db.transaction(STORE, mode);
          const req = run(t.objectStore(STORE));
          req.onsuccess = () => resolve((req.result as T) ?? fallback);
          req.onerror = () => resolve(fallback);
          t.onabort = () => resolve(fallback);
          t.onerror = () => resolve(fallback);
        } catch {
          resolve(fallback);
        }
      }),
  );
}

/** Resolves false rather than throwing — a refused write (quota, private mode)
 *  leaves the row with `hasBody: false`, which the list states plainly. */
function putBody(record: ArchivedRun & { id: string }): Promise<boolean> {
  return tx<IDBValidKey | null>("readwrite", (s) => s.put(record), null).then((key) => key !== null);
}

function getBody(id: string): Promise<ArchivedRun | null> {
  return tx<ArchivedRun | null>("readonly", (s) => s.get(id), null);
}

function delBody(id: string): Promise<void> {
  return tx<unknown>("readwrite", (s) => s.delete(id), null).then(() => undefined);
}

function clearBodies(): Promise<void> {
  return tx<unknown>("readwrite", (s) => s.clear(), null).then(() => undefined);
}

/**
 * Hold the saved briefs to a budget.
 *
 * Sized off the index rather than by reading the bodies back — every row
 * already carries its own `bytes`, so the accounting costs nothing. Children go
 * first regardless of age: one click on a board starts a dozen director runs,
 * and evicting strictly oldest-first would let a single afternoon's sweep push
 * out every company brief the user actually searched for. A director screen is
 * one "Run again" away; the brief it was picked from is the thing worth keeping.
 */
async function evictBodies(incomingBytes: number, protectId: string): Promise<void> {
  const budget = await bodyBudget();

  // Coldest first: every child before any parent, and within each group the
  // oldest.
  const held = readHistory()
    .filter((e) => e.hasBody && e.id !== protectId)
    .sort((a, b) => {
      if (Boolean(a.parentId) !== Boolean(b.parentId)) return a.parentId ? -1 : 1;
      return Date.parse(a.finishedAt ?? a.startedAt) - Date.parse(b.finishedAt ?? b.startedAt);
    });

  let count = held.length + 1;
  let bytes = held.reduce((n, e) => n + e.bytes, 0) + incomingBytes;
  const doomed: string[] = [];

  for (const e of held) {
    if (count <= MAX_BODIES && bytes <= budget) break;
    doomed.push(e.id);
    count -= 1;
    bytes -= e.bytes;
  }
  if (doomed.length === 0) return;

  await Promise.all(doomed.map((id) => delBody(id)));
  const gone = new Set(doomed);
  mutate((entries) => entries.map((e) => (gone.has(e.id) ? { ...e, hasBody: false, bytes: 0 } : e)));
}

/** Ask the browser what it actually has rather than trusting a constant — the
 *  origin quota varies by browser and by free disk. */
async function bodyBudget(): Promise<number> {
  try {
    const est = await navigator.storage?.estimate?.();
    if (est?.quota) return Math.max(4 * 1024 * 1024, Math.min(MAX_BODY_BYTES, Math.floor(est.quota * 0.4)));
  } catch {
    /* not supported — fall through to the constant */
  }
  return MAX_BODY_BYTES;
}

// ── Recording a run ─────────────────────────────────────────────────────────

/** Finishes already under way, so a double-fire from the poll costs one write
 *  rather than two whole-index rewrites and two snapshot builds. */
const finishing = new Set<string>();
/** Every body write, and the index write that follows it, in one chain — a
 *  synchronous `recordError` must not land between an async finish's put and
 *  its row update and get overwritten by it. */
let chain: Promise<void> = Promise.resolve();

export function recordStart(i: StartInput): void {
  mutate((entries) => upsert(entries, entryFromStart(i)));
}

/** A whole board sweep in one write. */
export function recordStarts(inputs: StartInput[]): void {
  if (inputs.length === 0) return;
  mutate((entries) => inputs.reduce((acc, i) => upsert(acc, entryFromStart(i)), entries));
}

export function recordServerId(id: string, serverId: string): void {
  patch(id, (prev) => (prev.serverId === serverId ? prev : { ...prev, serverId }));
}

export function recordError(id: string, message: string): void {
  chain = chain.then(() => {
    patch(id, (prev) =>
      // A run already archived is done. An error seen afterwards is the poll
      // losing contact with a server that has moved on, not the run failing.
      prev.outcome === "complete" ? prev : errorEntry(prev, message, Date.now()),
    );
  });
}

/** The run kept going after this browser stopped watching — a tab closed from
 *  the rail. Recorded as what is known, which is nothing about the outcome. */
export function recordUnknown(id: string): void {
  chain = chain.then(() => {
    patch(id, (prev) => (prev.outcome === "running" ? unknownEntry(prev) : prev));
  });
}

/**
 * Archive a finished run.
 *
 * Idempotent and cheap on the second call: a run already saved with its brief
 * returns immediately, without rebuilding a snapshot. That matters because this
 * is called from the poll's completion branch AND from the reload re-attach,
 * and the re-attach runs on every mount — not only after a crash.
 */
export function recordFinish(id: string, run: Run, startedAt?: number): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();

  chain = chain.then(async () => {
    if (finishing.has(id)) return;
    const existing = readHistory().find((e) => e.id === id);
    if (existing?.outcome === "complete" && existing.hasBody) return;

    finishing.add(id);
    try {
      const prev = existing ?? entryFromRun(id, run, startedAt);
      const body = snapshotRun(run);
      let bytes = 0;
      let saved = false;

      if (body) {
        bytes = byteLength(body);
        await evictBodies(bytes, id);
        saved = await putBody({ id, v: ARCHIVE_VERSION, entry: prev, run: body });
        if (!saved) {
          // Most likely a quota refusal against a budget the browser disagrees
          // with. Make room the hard way and try once more.
          await evictBodies(bytes * 8, id);
          saved = await putBody({ id, v: ARCHIVE_VERSION, entry: prev, run: body });
        }
      }

      mutate((entries) => upsert(entries, finishEntry(prev, run, saved ? bytes : 0, saved, Date.now())));
    } finally {
      finishing.delete(id);
    }
  });

  return chain;
}

// ── Reading and editing the record ──────────────────────────────────────────

/** Take a subject off the front page's short list without destroying the run.
 *  The × on "Recent searches" has always been a tidy-up; it must not quietly
 *  become the only copy of a brief being deleted. */
export function hideFromRecent(id: string): void {
  patch(id, (prev) => ({ ...prev, showInRecent: false }));
}

export function removeEntry(id: string): void {
  tombstones.add(id);
  mutate((entries) => entries.filter((e) => e.id !== id));
  chain = chain.then(() => delBody(id));
}

export function clearHistory(): void {
  if (typeof window === "undefined") return;
  for (const e of readHistory()) tombstones.add(e.id);
  commit([]);
  try {
    // An empty history is a stored fact, not an absent key — and the superseded
    // recent-search list goes with it. "Clear all" that leaves one of the two
    // places history lives untouched is a control that undoes itself.
    window.localStorage.setItem(INDEX_KEY, JSON.stringify({ v: ARCHIVE_VERSION, entries: [] }));
    window.localStorage.setItem(MIGRATED_KEY, "1");
    window.localStorage.removeItem("paragon.recentSearches");
  } catch {
    /* ignore */
  }
  chain = chain.then(() => clearBodies());
}

export function loadArchived(id: string): Promise<ArchivedRun | null> {
  return getBody(id);
}

export interface HistoryExport {
  app: "paragon-governance-prescreen";
  v: number;
  exportedAt: string;
  entries: ArchiveEntry[];
  runs: ArchivedRun[];
}

/** The record, portable. Bodies ride along — a list of names and dates is not a
 *  record of what was found, and the file is the only way this leaves the
 *  device it was made on. */
export async function exportHistory(): Promise<HistoryExport> {
  const entries = readHistory();
  const runs = (await Promise.all(entries.filter((e) => e.hasBody).map((e) => getBody(e.id)))).filter(
    (r): r is ArchivedRun => r !== null,
  );
  return {
    app: "paragon-governance-prescreen",
    v: ARCHIVE_VERSION,
    exportedAt: new Date().toISOString(),
    entries,
    runs,
  };
}

export interface ImportResult {
  added: number;
  skipped: number;
  briefs: number;
}

/** Merge a file back in — by run id, keeping what is already here. Restoring
 *  onto a laptop that has its own history must add to it, never replace it. */
export async function importHistory(raw: string): Promise<ImportResult> {
  let parsed: Partial<HistoryExport>;
  try {
    parsed = JSON.parse(raw) as Partial<HistoryExport>;
  } catch {
    throw new Error("That file isn’t readable JSON.");
  }
  const incoming = Array.isArray(parsed.entries) ? parsed.entries.filter(valid) : [];
  if (incoming.length === 0) throw new Error("No history rows in that file.");

  const have = new Set(readHistory().map((e) => e.id));
  const fresh = incoming.filter((e) => !have.has(e.id));
  const bodies = (Array.isArray(parsed.runs) ? parsed.runs : []).filter(
    (r) => r?.run?.brief && fresh.some((e) => e.id === r.entry?.id),
  );

  let briefs = 0;
  for (const r of bodies) {
    const ok = await putBody({ ...r, id: r.entry.id });
    if (ok) briefs += 1;
  }
  const stored = new Set(bodies.map((r) => r.entry.id));

  for (const e of fresh) tombstones.delete(e.id);
  mutate((entries) => [
    ...entries,
    ...fresh.map((e) => ({ ...e, hasBody: e.hasBody && stored.has(e.id) })),
  ]);

  return { added: fresh.length, skipped: incoming.length - fresh.length, briefs };
}
