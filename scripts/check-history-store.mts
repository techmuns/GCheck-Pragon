// ── The history store, against the ways it can lose a record ────────────────
// The archive is the only place a finished run survives — the server forgets on
// redeploy — so the failure that matters here is silent loss, not a crash. Every
// case below is one that was reproduced against the real module: a migration
// that claimed to be done before it had written anything, a "Clear all"
// overtaken by a run landing a second later, an error arriving after a
// successful archive and relabelling it, a delete undone by the other tab's copy
// of the index.
//
// The store keeps the index in memory on purpose, so "reload the page" means
// "re-evaluate the module" — and a module cannot be un-imported. Each page load
// is therefore a child process of this script, with localStorage and the
// IndexedDB contents carried between them in a JSON file, which is exactly the
// state a browser would have carried. Run it with no arguments to drive every
// case; the child form is an implementation detail.
//
// No network, no credential, no browser.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(import.meta.url);

// ── The stub browser, for a child run ───────────────────────────────────────

interface World {
  local: Record<string, string>;
  bodies: Record<string, unknown>;
}

function loadWorld(file: string): World {
  if (!existsSync(file)) return { local: {}, bodies: {} };
  return JSON.parse(readFileSync(file, "utf8")) as World;
}

function installBrowser(world: World, refuseWrites: boolean): void {
  const g = globalThis as Record<string, unknown>;

  const fire = (value: unknown, ok = true) => {
    const req: Record<string, unknown> = { result: ok ? value : undefined };
    queueMicrotask(() => {
      if (ok) (req.onsuccess as (() => void) | undefined)?.();
      else (req.onerror as (() => void) | undefined)?.();
    });
    return req;
  };

  g.window = {
    localStorage: {
      getItem: (k: string) => (k in world.local ? world.local[k] : null),
      setItem: (k: string, v: string) => {
        world.local[k] = String(v);
      },
      removeItem: (k: string) => {
        delete world.local[k];
      },
    },
    addEventListener: () => {},
    indexedDB: {
      open() {
        const req: Record<string, unknown> = { result: { objectStoreNames: { contains: () => true } } };
        queueMicrotask(() => (req.onsuccess as (() => void) | undefined)?.());
        (req.result as Record<string, unknown>).transaction = () => {
          const t: Record<string, unknown> = {};
          // Two microtasks out, so a request's own success/error always settles
          // first — which is what lets the readwrite path be tested for the case
          // where the request succeeds and the transaction then aborts.
          queueMicrotask(() => queueMicrotask(() => (t.oncomplete as (() => void) | undefined)?.()));
          return {
            set oncomplete(fn: () => void) {
              t.oncomplete = fn;
            },
            set onabort(fn: () => void) {
              t.onabort = fn;
            },
            set onerror(fn: () => void) {
              t.onerror = fn;
            },
            objectStore: () => ({
              put: (v: { id: string }) => {
                if (refuseWrites) return fire(undefined, false);
                world.bodies[v.id] = v;
                return fire(v.id);
              },
              get: (k: string) => fire(world.bodies[k] ?? null),
              delete: (k: string) => {
                delete world.bodies[k];
                return fire(k);
              },
              clear: () => {
                for (const k of Object.keys(world.bodies)) delete world.bodies[k];
                return fire(undefined);
              },
            }),
          };
        };
        return req;
      },
    },
  };

  // Node exposes `navigator` as a getter-only global, so it is redefined.
  Object.defineProperty(g, "navigator", {
    value: { storage: { estimate: async () => ({ quota: 200 * 1024 * 1024 }) } },
    configurable: true,
    writable: true,
  });
}

// ── The cases ───────────────────────────────────────────────────────────────
// Each is a list of page loads. A load gets fresh module state and inherits
// whatever the load before it left in storage.

type Store = typeof import("../lib/archiveStore");
type Load = (s: Store, ok: Assert) => void | Promise<void>;
type Assert = (label: string, condition: boolean, detail?: string) => void;

interface Case {
  title: string;
  /** Storage the browser already had before the first load. */
  seed?: Record<string, string>;
  refuseWrites?: boolean;
  loads: Load[];
}

const startInput = (id: string, company = "Adarsh Infrastructure") => ({
  id,
  rawQuery: company,
  subject: { type: "company" as const, company, promoters: [] },
  startedAt: Date.parse("2026-08-05T09:00:00.000Z"),
  showInRecent: true,
});

const settle = () => new Promise((r) => setTimeout(r, 25));

async function finishedRun() {
  const { mockRun } = await import("../app/print-preview/mocks");
  return { ...mockRun("max"), status: "complete" as const };
}

const LEGACY = JSON.stringify([
  { type: "company", company: "Acme Ltd", promoters: [], at: "2026-08-01T10:00:00.000Z" },
  { type: "director", company: "Vijay Malhotra", promoters: [], at: "2026-08-02T11:00:00.000Z" },
]);

const CASES: Record<string, Case> = {
  migration: {
    title: "legacy recent searches survive a reload with no run in between",
    seed: { "paragon.recentSearches": LEGACY },
    loads: [
      (s, ok) => {
        ok("carried across on first load", s.readHistory().length === 2, `${s.readHistory().length}`);
        ok("written to storage immediately", s.readHistory().length === 2);
      },
      // The user read the page, started nothing, and came back. Nothing on mount
      // writes the index, so a migration that set its sentinel before persisting
      // would have lost these rows here — permanently, because the sentinel
      // stops it ever running again.
      (s, ok) => ok("still there on the next load", s.readHistory().length === 2, `${s.readHistory().length}`),
    ],
  },

  clearAll: {
    title: "clear all is not undone by the next load",
    seed: { "paragon.recentSearches": LEGACY },
    loads: [
      async (s, ok) => {
        s.readHistory();
        s.clearHistory();
        await settle();
        ok("empty right after", s.readHistory().length === 0);
      },
      (s, ok) => ok("still empty on the next load", s.readHistory().length === 0, `${s.readHistory().length}`),
    ],
  },

  clearDuringFinish: {
    title: "a run finishing after clear all does not come back",
    loads: [
      async (s, ok) => {
        s.recordStart(startInput("run-1"));
        const pending = s.recordFinish("run-1", await finishedRun());
        s.clearHistory();
        await pending;
        await settle();
        ok("history stayed empty", s.readHistory().length === 0, s.readHistory().map((e) => e.id).join(","));
      },
      (s, ok) => {
        ok("and after a reload", s.readHistory().length === 0, `${s.readHistory().length}`);
        // A row that survived would claim a saved brief whose body the queued
        // clear deleted behind it — an Open that opens nothing.
      },
    ],
  },

  lateError: {
    title: "a late error does not relabel an archived run",
    loads: [
      async (s, ok) => {
        s.recordStart(startInput("run-2"));
        await s.recordFinish("run-2", await finishedRun());
        s.recordError("run-2", "Lost contact with the server.");
        await settle();
        const row = s.readHistory()[0];
        ok("outcome stayed complete", row.outcome === "complete", row.outcome);
        ok("verdict kept", row.verdict === "red", String(row.verdict));
      },
    ],
  },

  idempotentFinish: {
    title: "archiving twice does not move the finish time",
    loads: [
      async (s, ok) => {
        const run = await finishedRun();
        s.recordStart(startInput("run-3"));
        await s.recordFinish("run-3", run);
        const first = { ...s.readHistory()[0] };
        await new Promise((r) => setTimeout(r, 40));
        // What the reload re-attach does on every single mount.
        await s.recordFinish("run-3", run);
        const second = s.readHistory()[0];
        ok("finishedAt unchanged", first.finishedAt === second.finishedAt, `${first.finishedAt} → ${second.finishedAt}`);
        ok("duration unchanged", first.durationMs === second.durationMs);
      },
    ],
  },

  refusedBody: {
    title: "a refused body is recorded, not retried on every visit",
    refuseWrites: true,
    loads: [
      async (s, ok) => {
        s.recordStart(startInput("run-4"));
        await s.recordFinish("run-4", await finishedRun());
        const row = s.readHistory()[0];
        ok("row says it has no saved copy", row.hasBody === false, String(row.hasBody));
        ok("and remembers the refusal", row.bodyFailed === true, String(row.bodyFailed));
        ok("the run is still complete and re-runnable", row.outcome === "complete" && row.rawQuery.length > 0);
      },
      async (s, ok) => {
        // The guard must short-circuit on the refusal, or every mount rebuilds a
        // 65 KB snapshot and evicts other briefs to make room it will be refused
        // again anyway.
        await s.recordFinish("run-4", await finishedRun());
        ok("not retried on the next load", s.readHistory()[0].bodyFailed === true);
      },
    ],
  },

  deleteAcrossTabs: {
    title: "a deleted run is not resurrected by another tab's index",
    loads: [
      async (s, ok) => {
        s.recordStart(startInput("run-5", "Sterling Textiles"));
        s.recordStart(startInput("run-6", "Green Valley Farms"));
        await settle();
        ok("both recorded", s.readHistory().length === 2);
      },
      async (s, ok) => {
        // This load is the second tab: it holds both rows, the first tab deletes
        // one, and then this one writes its copy back.
        const theirs = JSON.stringify({ v: 1, entries: s.readHistory() });
        s.removeEntry("run-5");
        await settle();
        (globalThis as { window?: { localStorage: Storage } }).window!.localStorage.setItem(
          "paragon.runHistory.v1",
          theirs,
        );
        s.recordStart(startInput("run-7", "Vertex Holdings"));
        await settle();
        const ids = s.readHistory().map((e) => e.id);
        ok("stays deleted after the merge", !ids.includes("run-5"), ids.join(","));
        ok("the other rows survive", ids.includes("run-6") && ids.includes("run-7"), ids.join(","));
      },
      (s, ok) => {
        const ids = s.readHistory().map((e) => e.id);
        ok("and after a reload", !ids.includes("run-5"), ids.join(","));
      },
    ],
  },

  importFidelity: {
    title: "import only claims the briefs it actually stored",
    loads: [
      async (s, ok) => {
        s.recordStart(startInput("run-8"));
        await s.recordFinish("run-8", await finishedRun());
        const file = await s.exportHistory();
        ok("export carries the brief", file.runs.length === 1, `${file.runs.length}`);
        ok("and the row", file.entries.length === 1);
        writeFileSync(process.env.EXPORT_FILE!, JSON.stringify(file));
      },
    ],
  },

  importRefused: {
    title: "an import onto a browser that will not store bodies says so",
    refuseWrites: true,
    loads: [
      async (s, ok) => {
        const result = await s.importHistory(readFileSync(process.env.EXPORT_FILE!, "utf8"));
        await settle();
        ok("row imported", result.added === 1, `${result.added}`);
        ok("no brief claimed", result.briefs === 0, `${result.briefs}`);
        ok("and the row agrees", s.readHistory()[0]?.hasBody === false, String(s.readHistory()[0]?.hasBody));
      },
    ],
  },

  chainSurvives: {
    title: "a malformed run does not silence the store",
    loads: [
      async (s, ok) => {
        s.recordStart(startInput("run-9"));
        // A createdAt nothing can parse used to throw inside the write chain and
        // leave it a permanently rejected promise — every later write in the
        // session then became a silent no-op.
        await s.recordFinish("run-9", { ...(await finishedRun()), createdAt: "not a date" });
        s.recordStart(startInput("run-10", "Later Search Ltd"));
        await settle();
        ok(
          "the next run was still recorded",
          s.readHistory().some((e) => e.id === "run-10"),
          s.readHistory().map((e) => e.id).join(","),
        );
      },
    ],
  },

  recentDedupe: {
    title: "the front page's short list holds distinct subjects, and × clears one",
    loads: [
      async (s, ok) => {
        const { listRecent } = await import("../lib/archive");
        for (const id of ["a1", "a2", "a3"]) s.recordStart(startInput(id, "Reliance Industries"));
        s.recordStart(startInput("b1", "Sterling Textiles"));
        await settle();
        const recent = listRecent(s.readHistory());
        ok("one row per subject", recent.length === 2, recent.map((e) => e.company).join(","));
        ok("history keeps every run", s.readHistory().length === 4, `${s.readHistory().length}`);

        // Hiding must take the subject off the list, not just one of its runs —
        // otherwise the previous run of the same company steps into the slot.
        s.hideSubjectFromRecent(recent[0].id);
        await settle();
        const after = listRecent(s.readHistory());
        ok("the subject is gone from the list", after.length === 1, after.map((e) => e.company).join(","));
        ok("but all four runs are still in history", s.readHistory().length === 4);
      },
    ],
  },
};

// ── Child: run one page load ────────────────────────────────────────────────

const stepArg = process.argv.indexOf("--step");
if (stepArg > -1) {
  const [name, index, worldFile] = process.argv.slice(stepArg + 1);
  const world = loadWorld(worldFile);
  const kase = CASES[name];
  installBrowser(world, Boolean(kase.refuseWrites));

  let bad = 0;
  const ok: Assert = (label, condition, detail = "") => {
    if (condition) console.log(`    ✓ ${label}`);
    else {
      bad += 1;
      console.log(`    ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    }
  };

  const store = (await import("../lib/archiveStore")) as Store;
  await kase.loads[Number(index)](store, ok);
  await settle();
  writeFileSync(worldFile, JSON.stringify(world));
  process.exit(bad > 0 ? 1 : 0);
}

// ── Driver ──────────────────────────────────────────────────────────────────

console.log("→ History store: the ways a record can be lost\n");

const dir = mkdtempSync(path.join(tmpdir(), "paragon-history-"));
const exportFile = path.join(dir, "export.json");
let failures = 0;

for (const [name, kase] of Object.entries(CASES)) {
  console.log(`  ${kase.title}`);
  const worldFile = path.join(dir, `${name}.json`);
  writeFileSync(worldFile, JSON.stringify({ local: kase.seed ?? {}, bodies: {} } satisfies World));

  for (let i = 0; i < kase.loads.length; i++) {
    try {
      const out = execFileSync(process.execPath, [
        ...process.execArgv,
        HERE,
        "--step",
        name,
        String(i),
        // importRefused reads the file importFidelity wrote.
        name === "importRefused" ? path.join(dir, "importRefused.json") : worldFile,
      ], {
        encoding: "utf8",
        env: { ...process.env, EXPORT_FILE: exportFile },
        stdio: ["ignore", "pipe", "pipe"],
      });
      process.stdout.write(out);
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string };
      process.stdout.write(err.stdout ?? "");
      if (err.stderr?.trim()) console.log(`    ✗ load ${i + 1} crashed: ${err.stderr.trim().split("\n")[0]}`);
      failures += 1;
    }
  }
  console.log("");
}

if (failures > 0) {
  console.error(`✗ ${failures} history-store load${failures === 1 ? "" : "s"} failed.`);
  process.exit(1);
}
console.log("✓ The record survives every case.");
