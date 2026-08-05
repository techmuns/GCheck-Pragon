import {
  ARCHIVE_VERSION,
  byteLength,
  entryFromRun,
  entryFromStart,
  errorEntry,
  finishEntry,
  snapshotRun,
  subjectKey,
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
/** Deletions are remembered so another tab's copy of the index cannot put a row
 *  back. They expire — a tombstone older than any index row it could resurrect
 *  is just weight. */
const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const TOMBSTONE_MAX = 300;

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
/** Ids deleted, and when — so neither another tab's copy of the index nor a run
 *  still finishing in this one can put a deleted row back. Persisted with the
 *  index, because a tombstone only this tab knows about is a tombstone the
 *  other tab will happily overwrite. */
const tombstones = new Map<string, number>();
/** Bumped by "Clear all". A write already in flight re-checks it after each
 *  await and gives up if the record was cleared underneath it. */
let epoch = 0;
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

interface Envelope {
  v: number;
  entries: ArchiveEntry[];
  /** Deletions, so every tab honours every tab's. */
  deleted?: Array<{ id: string; at: number }>;
}

function parseEnvelope(raw: string | null): { entries: ArchiveEntry[]; deleted: Array<{ id: string; at: number }> } {
  if (!raw) return { entries: [], deleted: [] };
  try {
    const parsed = JSON.parse(raw) as unknown;
    // An envelope from day one, so a future shape change is an upgrade rather
    // than a second key and an orphaned first one. A bare array is tolerated in
    // case anything ever wrote one.
    const rows = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as Envelope | null)?.entries)
        ? (parsed as Envelope).entries
        : [];
    const deleted = Array.isArray((parsed as Envelope | null)?.deleted)
      ? (parsed as Envelope).deleted!.filter(
          (d) => typeof d?.id === "string" && Number.isFinite(d?.at),
        )
      : [];
    return { entries: (rows as unknown[]).filter(valid).sort(newestFirst), deleted };
  } catch {
    return { entries: [], deleted: [] };
  }
}

function parseIndex(raw: string | null): ArchiveEntry[] {
  return parseEnvelope(raw).entries;
}

/** Adopt another tab's deletions alongside our own, and drop the ones too old
 *  to still be protecting anything. */
function absorbTombstones(deleted: Array<{ id: string; at: number }>): void {
  const now = Date.now();
  for (const d of deleted) if (!tombstones.has(d.id)) tombstones.set(d.id, d.at);
  for (const [id, at] of tombstones) if (now - at > TOMBSTONE_TTL_MS) tombstones.delete(id);
  if (tombstones.size > TOMBSTONE_MAX) {
    const oldest = [...tombstones.entries()].sort((a, b) => a[1] - b[1]);
    for (const [id] of oldest.slice(0, tombstones.size - TOMBSTONE_MAX)) tombstones.delete(id);
  }
}

/**
 * Carry the old five-item recent list across, once.
 *
 * The sentinel is written by the caller, and only once the converted rows have
 * actually reached storage. Claiming the migration is done before persisting it
 * is how an upgrade that nobody interrupted still loses the five rows: they
 * would live in memory for one page view, never be written, and the sentinel
 * would stop them ever being read again.
 */
function migrate(): ArchiveEntry[] {
  if (window.localStorage.getItem(MIGRATED_KEY)) return [];
  try {
    return getRecentSearches()
      .filter((r) => Number.isFinite(Date.parse(r.at)))
      .map((r, i): ArchiveEntry => ({
        id: `legacy-${i}-${Date.parse(r.at)}`,
        showInRecent: true,
        rawQuery: r.company,
        type: r.type ?? "company",
        company: r.company,
        promoters: r.promoters,
        startedAt: r.at,
        // These rows are a subject and a time. Nothing was ever kept about how
        // the run ended, and the list says exactly that rather than borrowing
        // the wording of a run this browser stopped watching.
        outcome: "legacy",
        red: 0,
        amber: 0,
        sourcesDone: 0,
        sourcesTotal: 0,
        hasBody: false,
        bytes: 0,
      }));
  } catch {
    return [];
  }
}

function load(): ArchiveEntry[] {
  if (typeof window === "undefined") return [];
  const { entries, deleted } = parseEnvelope(window.localStorage.getItem(INDEX_KEY));
  absorbTombstones(deleted);
  const done = () => {
    try {
      window.localStorage.setItem(MIGRATED_KEY, "1");
    } catch {
      /* ignore */
    }
  };

  if (entries.length > 0) {
    // A browser that already carried its legacy rows across must not re-import
    // them after a "Clear all".
    if (!window.localStorage.getItem(MIGRATED_KEY)) done();
    return entries;
  }

  const migrated = migrate().sort(newestFirst);
  if (migrated.length === 0) {
    done();
    return entries;
  }
  // Persist first, claim second. Nothing else on mount writes the index, so a
  // user who opens the page and reads it without starting a search would
  // otherwise lose the rows on their next reload.
  write(migrated);
  done();
  return migrated;
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

/** A cheap identity for "what the subscribers were last shown", so a flush that
 *  silently trimmed the list can tell it has to say so. */
function signature(entries: ArchiveEntry[]): string {
  return `${entries.length}:${entries.map((e) => e.id).join(",")}`;
}

function tombstonePayload(): Array<{ id: string; at: number }> {
  return [...tombstones.entries()].map(([id, at]) => ({ id, at }));
}

function write(entries: ArchiveEntry[]): void {
  const envelope = (rows: ArchiveEntry[]) =>
    JSON.stringify({ v: ARCHIVE_VERSION, entries: rows, deleted: tombstonePayload() } satisfies Envelope);
  try {
    window.localStorage.setItem(INDEX_KEY, envelope(entries));
  } catch {
    // Out of room. Drop the oldest half and try once more; if that fails the
    // index stays as it was on disk, which is worse than the truth but never
    // an exception thrown at whatever was recording a run.
    const half = entries.slice(0, Math.max(1, Math.floor(entries.length / 2)));
    try {
      window.localStorage.setItem(INDEX_KEY, envelope(half));
      cache = half;
    } catch {
      /* give up quietly */
    }
  }
}

function flush(): void {
  if (typeof window === "undefined" || cache === null) return;
  const before = signature(cache);

  // Merge with whatever is on disk before writing. Two tabs both hold the whole
  // array, so a plain overwrite would silently drop a run the other one just
  // finished. Ours wins per id; anything either tab deleted stays deleted.
  const { entries: disk, deleted } = parseEnvelope(window.localStorage.getItem(INDEX_KEY));
  absorbTombstones(deleted);

  const byId = new Map<string, ArchiveEntry>();
  for (const e of disk) if (!tombstones.has(e.id)) byId.set(e.id, e);
  for (const e of cache) if (!tombstones.has(e.id)) byId.set(e.id, e);

  let merged = [...byId.values()].sort(newestFirst).slice(0, MAX_ENTRIES);
  while (merged.length > 1 && byteLength(merged) > MAX_INDEX_BYTES) {
    merged = merged.slice(0, Math.max(1, merged.length - 25));
  }

  cache = merged;
  write(merged);
  // The merge can add another tab's runs and the budget can drop the oldest —
  // either way what is on screen is no longer what is stored, and a list that
  // shows a row the store has just dropped is a list with a dead Open button.
  if (signature(cache) !== before) emit();
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

/** Another tab wrote the index. Adopt it rather than fighting over it — but
 *  not its idea of what still exists: a row this tab deleted a moment ago is
 *  still deleted, and adopting the other tab's copy wholesale would put it
 *  back on screen. */
function onStorage(e: StorageEvent): void {
  if (e.key !== INDEX_KEY) return;
  const { entries, deleted } = parseEnvelope(e.newValue);
  absorbTombstones(deleted);
  cache = entries.filter((row) => !tombstones.has(row.id));
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
          let result: T = fallback;
          req.onsuccess = () => {
            result = (req.result as T) ?? fallback;
            // A read is answered by its request. A write is not answered until
            // the transaction commits: a quota failure surfaces at commit time,
            // after the put has already reported success, and reporting that as
            // a saved brief is how a row comes to offer an Open that opens
            // nothing.
            if (mode === "readonly") resolve(result);
          };
          req.onerror = () => resolve(fallback);
          t.oncomplete = () => resolve(result);
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

/**
 * Every body write, and the index write that follows it, in one chain.
 *
 * A synchronous `recordError` must not land between an async finish's put and
 * its row update and get overwritten by it. The chain is also self-healing: a
 * step that throws is swallowed rather than left as a rejected promise, because
 * a single malformed run must not silently turn every later write in the
 * session into a no-op.
 */
let chain: Promise<void> = Promise.resolve();

function queue(step: () => void | Promise<void>): Promise<void> {
  chain = chain.then(step).catch(() => {});
  return chain;
}

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
  void queue(() => {
    patch(id, (prev) =>
      // A run already archived is done. An error seen afterwards is the poll
      // losing contact with a server that has moved on, not the run failing.
      prev.outcome === "complete" ? prev : errorEntry(prev, message, Date.now()),
    );
  });
}

/** The run kept going after this browser stopped watching — a tab closed from
 *  the rail, or a client-side timeout on a run the server is still working. */
export function recordUnknown(id: string): void {
  void queue(() => {
    patch(id, (prev) => (prev.outcome === "running" ? unknownEntry(prev) : prev));
  });
}

/**
 * Archive a finished run.
 *
 * Idempotent and cheap on the second call: a run already saved with its brief —
 * or one whose brief storage was already refused — returns immediately, without
 * rebuilding a snapshot. That matters because this is called from the poll's
 * completion branch AND from the reload re-attach, and the re-attach runs on
 * every mount, not only after a crash. Without the refusal case in the guard, a
 * browser that will not store bodies would rebuild a 65 KB snapshot and evict
 * other people's briefs to make room for it, on every single visit.
 */
export function recordFinish(id: string, run: Run, startedAt?: number): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();

  return queue(async () => {
    if (finishing.has(id)) return;
    // The record was cleared, or this row deleted, since the run started. Both
    // are the user saying they do not want it; finishing it would put it back.
    const era = epoch;
    if (tombstones.has(id)) return;

    const existing = readHistory().find((e) => e.id === id);
    if (existing?.outcome === "complete" && (existing.hasBody || existing.bodyFailed)) return;
    if (!existing && tombstones.has(id)) return;

    finishing.add(id);
    try {
      const prev = existing ?? entryFromRun(id, run, startedAt);
      const body = snapshotRun(run);
      let bytes = 0;
      let saved = false;

      if (body) {
        bytes = byteLength(body);
        await evictBodies(bytes, id);
        if (epoch !== era) return;
        saved = await putBody({ id, v: ARCHIVE_VERSION, entry: prev, run: body });
        if (!saved) {
          // Most likely a quota refusal against a budget the browser disagrees
          // with. Make a little more room and try once; anything more
          // aggressive trades other people's briefs for one that may well be
          // refused again anyway.
          await evictBodies(bytes * 2, id);
          if (epoch !== era) return;
          saved = await putBody({ id, v: ARCHIVE_VERSION, entry: prev, run: body });
        }
      }

      // Re-checked after every await: "Clear all" may have run while the body
      // was being written, and a row upserted after that would come back from
      // the dead with its body already deleted behind it.
      if (epoch !== era || tombstones.has(id)) return;

      mutate((entries) =>
        upsert(
          entries,
          finishEntry(prev, run, {
            bytes: saved ? bytes : 0,
            hasBody: saved,
            bodyFailed: Boolean(body) && !saved,
            now: Date.now(),
          }),
        ),
      );
    } finally {
      finishing.delete(id);
    }
  });
}

// ── Reading and editing the record ──────────────────────────────────────────

export function removeEntry(id: string): void {
  tombstones.set(id, Date.now());
  mutate((entries) => entries.filter((e) => e.id !== id));
  void queue(() => delBody(id));
}

/** Every subject on the front page's short list shares one identity, and the ×
 *  there promises to take that subject off it. Hiding a single run id would let
 *  the previous run of the same company step straight into the empty slot. */
export function hideSubjectFromRecent(id: string): void {
  mutate((entries) => {
    const target = entries.find((e) => e.id === id);
    if (!target) return entries;
    const key = subjectKey(target);
    return entries.map((e) => (subjectKey(e) === key ? { ...e, showInRecent: false } : e));
  });
}

export function clearHistory(): void {
  if (typeof window === "undefined") return;
  // Anything still finishing checks this before it writes, so a run that lands
  // a second after the clear does not walk back into an emptied list.
  epoch += 1;
  const now = Date.now();
  for (const e of readHistory()) tombstones.set(e.id, now);
  commit([]);
  try {
    // An empty history is a stored fact, not an absent key — and the superseded
    // recent-search list goes with it. "Clear all" that leaves one of the two
    // places history lives untouched is a control that undoes itself.
    write([]);
    window.localStorage.setItem(MIGRATED_KEY, "1");
    window.localStorage.removeItem("paragon.recentSearches");
  } catch {
    /* ignore */
  }
  void queue(() => clearBodies());
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

  // `hasBody` must track what storage actually accepted, not what was offered
  // — a row claiming a saved brief it does not have is an Open that opens
  // nothing, which is the one thing this list must never show.
  const stored = new Set<string>();
  for (const r of bodies) {
    if (await putBody({ ...r, id: r.entry.id })) stored.add(r.entry.id);
  }
  const briefs = stored.size;

  // Re-importing a row the user deleted here is them asking for it back.
  for (const e of fresh) tombstones.delete(e.id);
  mutate((entries) => [
    ...entries,
    ...fresh.map((e) => ({ ...e, hasBody: e.hasBody && stored.has(e.id) })),
  ]);

  return { added: fresh.length, skipped: incoming.length - fresh.length, briefs };
}
