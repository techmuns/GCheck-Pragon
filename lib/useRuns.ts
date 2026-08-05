"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiUrl } from "./api";
import { recordError, recordFinish, recordServerId, recordStart, recordUnknown } from "./archiveStore";
import { displayName } from "./directorId";
import type { Run, Subject } from "./types";

// ── Several pre-screens at once ─────────────────────────────────────────────
// The server was always capable of this: every run gets its own id, and the
// workflow is fired detached from the request that started it. Only the client
// insisted on one — a single `run` in state and a single poll, so starting a
// second search silently abandoned the first.
//
// That was fine when a run took under a minute. It is not fine now: a deep run
// spends minutes on twenty searches and the articles behind them, and being
// unable to look at anything else for the duration makes the depth a cost
// rather than a feature. So the client tracks a set of runs, polls all the live
// ones together, and lets you move between them freely. Nothing here can
// interrupt a run — there is deliberately no cancel; a run in flight is work
// already paid for.

const POLL_MS = 500;

/** Past this a run will never land — a recycled instance, most likely. Set
 *  generously: a company run now screens its whole board director by director
 *  after the brief lands, which is legitimately minutes of extra work. */
const RUN_TIMEOUT_MS = 20 * 60 * 1000;

/** Consecutive failed polls tolerated before a run is given up on. Counted per
 *  run, so one dead run never takes its siblings down with it. */
const MAX_POLL_FAILURES = 10;

/** How many runs to keep on screen. Older finished ones drop off the end.
 *
 *  Sized for the board sweep: picking several key people off one brief starts a
 *  run each, and a cap of six meant a five-person pick could evict the very
 *  brief they were picked from. */
const MAX_TRACKED = 14;

const STORE_KEY = "paragon.openRuns";

export type RunPhase = "starting" | "running" | "done" | "error";

export interface TrackedRun {
  /** Stable client-side identity. Exists before the server has issued an id,
   *  so the tab can be rendered and selected the instant it is started. */
  key: string;
  /** The server's run id, once the POST returns. */
  serverId?: string;
  /** What the user typed, shown until the run itself arrives and the registry
   *  replaces it with the name on the record. */
  subject: Subject;
  run: Run | null;
  phase: RunPhase;
  error?: string;
  startedAt: number;
  /** False when a run finished while the user was looking at something else —
   *  the only thing that earns an attention dot. */
  seen: boolean;
  /** The run this one was started from — set when a key person is picked off a
   *  brief and screened in their own right. The rail nests these under their
   *  parent, because a director pulled off a board is not a search the user
   *  made from the front door and does not read as one in a flat list. */
  parentKey?: string;
}

function newKey(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** What survives a reload: enough to re-attach to a run the server still has. */
interface StoredRun {
  key: string;
  serverId: string;
  subject: Subject;
  startedAt: number;
  parentKey?: string;
}

function readStore(): StoredRun[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is StoredRun => typeof r?.serverId === "string" && typeof r?.subject?.company === "string",
    );
  } catch {
    return [];
  }
}

function writeStore(runs: TrackedRun[]): void {
  if (typeof window === "undefined") return;
  try {
    const keep = runs
      .filter((t): t is TrackedRun & { serverId: string } => Boolean(t.serverId))
      .map(({ key, serverId, subject, startedAt, parentKey }) => ({ key, serverId, subject, startedAt, parentKey }));
    window.localStorage.setItem(STORE_KEY, JSON.stringify(keep));
  } catch {
    /* storage unavailable — reattaching after a reload is a nicety, not a promise */
  }
}

export interface StartOptions {
  /** Start this run beneath an existing one, rather than as a search of its
   *  own. Used when a key person is picked off a brief and screened. */
  parentKey?: string;
  /** Leave the user where they are instead of switching to the new run.
   *  Picking five people off a board starts five runs, and jumping to
   *  whichever finished being created last would take the reader off the brief
   *  they are still reading. */
  keepFocus?: boolean;
  /** Keep this out of the front page's short recent list. The run is still
   *  recorded in history — it happened, and it is one of the things the user
   *  will look for later — but a child run is reachable from its parent, and
   *  five of them from one click would flush everything the user actually
   *  searched for out of the five-item list on the front door. */
  skipHistory?: boolean;
}

export interface UseRuns {
  runs: TrackedRun[];
  /** The run being viewed, or null when the search form is up. */
  active: TrackedRun | null;
  activeKey: string | null;
  start: (
    company: string,
    promoters: string[],
    type?: "company" | "director",
    ticker?: string,
    opts?: StartOptions,
  ) => void;
  /** Show a run. Passing null shows the search form without touching anything. */
  select: (key: string | null) => void;
  /** Stop tracking a run in the UI. The server keeps working; this is a tab
   *  close, not a cancel. */
  close: (key: string) => void;
}

export function useRuns(): UseRuns {
  const [runs, setRuns] = useState<TrackedRun[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);

  // The interval reads through these so it never has to be torn down and
  // rebuilt as runs come and go — a poll that restarts on every state change
  // loses its place and re-fetches everything.
  const runsRef = useRef<TrackedRun[]>([]);
  const activeRef = useRef<string | null>(null);
  const failures = useRef<Record<string, number>>({});

  useEffect(() => {
    runsRef.current = runs;
    writeStore(runs);
  }, [runs]);
  useEffect(() => {
    activeRef.current = activeKey;
  }, [activeKey]);

  const patch = useCallback((key: string, next: Partial<TrackedRun>) => {
    setRuns((prev) => prev.map((t) => (t.key === key ? { ...t, ...next } : t)));
  }, []);

  // Re-attach to runs still in flight after a reload. A run the server no
  // longer has is dropped in silence: it expired or the instance recycled, and
  // an error card about a run the user may have forgotten is just noise.
  useEffect(() => {
    const stored = readStore();
    if (stored.length === 0) return;
    let cancelled = false;

    void Promise.all(
      stored.map(async (s): Promise<TrackedRun | null> => {
        try {
          const res = await fetch(apiUrl(`/api/research/${s.serverId}`));
          if (!res.ok) return null;
          const run: Run = await res.json();
          // A run that ended while the tab was shut is recorded here — this is
          // the only place that ending is ever observed. `recordFinish` is a
          // no-op for a run already saved, so the re-attach (which runs on
          // every mount, not only after a crash) costs nothing on a revisit.
          // The failure branch matters as much: without it a run that errored
          // overnight sits in history claiming to be running, and the staleness
          // heuristic eventually relabels it as one nobody ever saw the end of.
          if (run.status === "complete") void recordFinish(s.key, run, s.startedAt);
          else if (run.status === "error") recordError(s.key, run.error ?? "The pre-screen failed.");
          return {
            key: s.key,
            serverId: s.serverId,
            subject: run.subject ?? s.subject,
            run,
            phase: run.status === "complete" ? "done" : run.status === "error" ? "error" : "running",
            error: run.error,
            startedAt: s.startedAt,
            seen: true,
            parentKey: s.parentKey,
          };
        } catch {
          return null;
        }
      }),
    ).then((restored) => {
      if (cancelled) return;
      const live = restored.filter((r): r is TrackedRun => r !== null);
      if (live.length === 0) return;
      // Merged by key, not swapped in wholesale. A search started while these
      // were still being fetched used to throw every restored run away — and
      // the next `writeStore` then erased them from storage too, so a run still
      // in flight became unreachable because the user was quick.
      setRuns((prev) => {
        const have = new Set(prev.map((t) => t.key));
        return trim([...prev, ...live.filter((t) => !have.has(t.key))]);
      });
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // One interval for every live run. They are polled together, so N runs cost
  // one tick rather than N competing timers.
  useEffect(() => {
    const tick = async () => {
      const live = runsRef.current.filter(
        (t) => t.serverId && (t.phase === "starting" || t.phase === "running"),
      );
      if (live.length === 0) return;

      await Promise.all(
        live.map(async (t) => {
          const key = t.key;
          const fail = (message: string) => {
            // History records what the client actually saw. `recordError`
            // refuses to downgrade a run already archived, so a poll losing
            // contact with a server that has moved on cannot relabel a
            // successful run as a failure.
            recordError(key, message);
            patch(key, { phase: "error", error: message });
          };

          if (Date.now() - t.startedAt > RUN_TIMEOUT_MS) {
            // This browser's patience running out is not the run failing. The
            // server may well still be working, so history records that it
            // stopped watching rather than inventing a failure and a finish
            // time for a run that has neither.
            recordUnknown(key);
            patch(key, {
              phase: "error",
              error: "This pre-screen is taking longer than expected. Please run it again.",
            });
            return;
          }

          try {
            const res = await fetch(apiUrl(`/api/research/${t.serverId}`));
            if (res.status === 404) {
              fail("This pre-screen is no longer available — the server restarted. Please run it again.");
              return;
            }
            if (!res.ok) {
              failures.current[key] = (failures.current[key] ?? 0) + 1;
              if (failures.current[key] >= MAX_POLL_FAILURES) fail("Lost contact with the server. Please try again.");
              return;
            }
            const run: Run = await res.json();
            failures.current[key] = 0;

            // Adopt the run's own subject as soon as it has one. A search typed
            // as a bare DIN starts life labelled "07013291"; once the register
            // answers, the tab should say whose it is.
            const subject = run.subject ?? t.subject;

            if (run.status === "complete") {
              // The one place a live finish is recorded. `recordFinish` guards
              // itself against a second call, so a tick that fires before the
              // phase patch has committed costs one write, not two.
              void recordFinish(key, run, t.startedAt);
              // Only a run that finished out of sight earns an attention dot.
              patch(key, { run, subject, phase: "done", seen: activeRef.current === key });
            } else if (run.status === "error") {
              recordError(key, run.error ?? "The pre-screen failed.");
              patch(key, { run, subject, phase: "error", error: run.error ?? "The pre-screen failed." });
            } else {
              patch(key, { run, subject, phase: "running" });
            }
          } catch {
            // Offline or a cut-off request. Tolerate a blip, give up on a
            // pattern — and never let the rejection escape the interval.
            failures.current[key] = (failures.current[key] ?? 0) + 1;
            if (failures.current[key] >= MAX_POLL_FAILURES) fail("Lost contact with the server. Please try again.");
          }
        }),
      );
    };

    const id = setInterval(() => void tick(), POLL_MS);
    return () => clearInterval(id);
  }, [patch]);

  const start = useCallback(
    (
      company: string,
      promoters: string[],
      type: "company" | "director" = "company",
      ticker?: string,
      opts: StartOptions = {},
    ) => {
      const key = newKey();
      const subject: Subject = {
        type,
        company: type === "director" ? displayName(company) : company,
        promoters,
        ticker,
      };

      const fresh: TrackedRun = {
        key,
        subject,
        run: null,
        phase: "starting",
        startedAt: Date.now(),
        seen: true,
        parentKey: opts.parentKey,
      };

      setRuns((prev) => (opts.parentKey ? insertUnderParent(prev, fresh, opts.parentKey) : promote(prev, fresh)));
      if (!opts.keepFocus) setActiveKey(key);

      // Recorded the moment it starts, and recorded with the raw query — the
      // DIN-decorated string, not the display name — so "run again" re-runs the
      // same person rather than falling back to their name and picking up
      // whoever else shares it. A run that never gets a server id still leaves
      // a row saying it was attempted.
      recordStart({
        id: key,
        rawQuery: company,
        subject,
        startedAt: fresh.startedAt,
        parentId: opts.parentKey,
        showInRecent: !opts.skipHistory,
      });

      void (async () => {
        try {
          const res = await fetch(apiUrl("/api/research"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type, company, promoters, ticker }),
          });
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.error ?? "Could not start the pre-screen.");
          }
          const { id } = await res.json();
          recordServerId(key, id);
          patch(key, { serverId: id, phase: "running" });
        } catch (e) {
          const message = e instanceof Error ? e.message : "Something went wrong.";
          recordError(key, message);
          patch(key, { phase: "error", error: message });
        }
      })();
    },
    [patch],
  );

  const select = useCallback(
    (key: string | null) => {
      setActiveKey(key);
      if (key) patch(key, { seen: true });
    },
    [patch],
  );

  const close = useCallback((key: string) => {
    // Closing a brief closes the runs started from it. They were opened while
    // reading that brief and are reached through it; left behind they would
    // read as searches from the front door that the user never made.
    // The whole subtree, not one generation: a director screened off a company
    // brief can have companies screened off theirs, and a grandchild left
    // behind renders as a search from the front door that nobody made.
    const doomed = new Set<string>([key]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const t of runsRef.current) {
        if (t.parentKey && doomed.has(t.parentKey) && !doomed.has(t.key)) {
          doomed.add(t.key);
          grew = true;
        }
      }
    }

    // Closing stops watching, not running — so a run still in flight is
    // recorded as exactly that. Left alone its history row would sit at
    // "running" until the staleness heuristic relabelled it as one that never
    // landed, which is the opposite of what the close button's own tooltip
    // promises. History can still ask the server for it later.
    for (const t of runsRef.current) {
      if (doomed.has(t.key) && (t.phase === "starting" || t.phase === "running")) recordUnknown(t.key);
    }

    setRuns((prev) => prev.filter((t) => !doomed.has(t.key)));
    setActiveKey((cur) => (cur && doomed.has(cur) ? null : cur));
    for (const k of doomed) delete failures.current[k];
  }, []);

  const active = runs.find((t) => t.key === activeKey) ?? null;
  return { runs, active, activeKey, start, select, close };
}

/**
 * A new search goes to the top of the rail.
 *
 * The list used to be re-sorted by phase on every start, floating live runs
 * above finished ones. That was how it protected work in flight from being
 * evicted — but it also tears a parent away from the runs started off it the
 * moment their phases differ, which is most of the time. Eviction is now
 * handled directly in `trim`, so the order can simply be left alone.
 */
function promote(prev: TrackedRun[], fresh: TrackedRun): TrackedRun[] {
  return trim([fresh, ...prev]);
}

/**
 * A run started off a brief belongs directly under it, after any siblings
 * already there — the rail then reads as "this brief, and the people screened
 * from it". Prepending would put a director above the board they came from.
 */
function insertUnderParent(prev: TrackedRun[], fresh: TrackedRun, parentKey: string): TrackedRun[] {
  const at = prev.findIndex((t) => t.key === parentKey);
  if (at < 0) return promote(prev, fresh);
  let insert = at + 1;
  while (insert < prev.length && prev[insert].parentKey === parentKey) insert += 1;
  return trim([...prev.slice(0, insert), fresh, ...prev.slice(insert)]);
}

/**
 * Hold the rail to its cap, dropping the coldest finished runs first.
 *
 * Two runs are never dropped to make room: one still in flight, and one that
 * something else on the rail was started from. Evicting a parent would orphan
 * its children, which would then render as ordinary searches from the front
 * door — searches the user never made. Where everything is protected the cap
 * is allowed to be exceeded, because every alternative loses something the
 * user is actively waiting on.
 */
function trim(runs: TrackedRun[]): TrackedRun[] {
  if (runs.length <= MAX_TRACKED) return runs;
  const parents = new Set(runs.map((t) => t.parentKey).filter(Boolean));
  const out = [...runs];
  for (let i = out.length - 1; i >= 0 && out.length > MAX_TRACKED; i--) {
    const t = out[i];
    if (t.phase === "starting" || t.phase === "running") continue;
    if (parents.has(t.key)) continue;
    out.splice(i, 1);
  }
  return out;
}

/** How far along a run is, as sources actually settled over sources planned. */
export function runProgress(t: TrackedRun): { done: number; total: number } {
  const progress = t.run?.progress ?? [];
  const total = progress.length;
  const done = progress.filter((p) => p.status !== "pending" && p.status !== "running").length;
  return { done, total };
}
