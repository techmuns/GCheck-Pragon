import { promises as fs } from "fs";
import path from "path";
import { defaultConfig } from "./config";
import type { AppConfig, Run, Subject } from "./types";

// ── Config store (file-backed) ─────────────────────────────────────────────
// Config lives in data/config.json so the Phase 4 admin panel can persist
// edits. Seeded from defaults on first read.

const DATA_DIR = path.join(process.cwd(), "data");
const CONFIG_PATH = path.join(DATA_DIR, "config.json");

export async function getConfig(): Promise<AppConfig> {
  try {
    const raw = await fs.readFile(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<AppConfig>;
    // Backfill any fields a older config file predates (e.g. synthesisPrompt).
    return {
      sources: parsed.sources ?? defaultConfig.sources,
      keywords: parsed.keywords ?? defaultConfig.keywords,
      sections: parsed.sections ?? defaultConfig.sections,
      synthesisPrompt: parsed.synthesisPrompt ?? defaultConfig.synthesisPrompt,
    };
  } catch {
    await saveConfig(defaultConfig);
    return defaultConfig;
  }
}

export async function saveConfig(config: AppConfig): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
}

// ── Run store (in-memory) ──────────────────────────────────────────────────
// Held on globalThis so every route bundle and the fire-and-forget workflow
// share one instance (Next.js gives separate route handlers separate module
// instances otherwise). Persistence to a DB is the production swap.

interface RunStore {
  runs: Map<string, Run>;
  seq: number;
}

const g = globalThis as unknown as { __paragonRunStore?: RunStore };
const store: RunStore = (g.__paragonRunStore ??= { runs: new Map(), seq: 0 });
const runs = store.runs;

function newId(): string {
  store.seq += 1;
  return `run_${Date.now().toString(36)}_${store.seq}`;
}

export function createRun(subject: Subject, progressSeed: Run["progress"]): Run {
  const run: Run = {
    id: newId(),
    subject,
    status: "queued",
    createdAt: new Date().toISOString(),
    progress: progressSeed,
  };
  runs.set(run.id, run);
  return run;
}

export function getRun(id: string): Run | undefined {
  return runs.get(id);
}

export function updateRun(id: string, patch: Partial<Run>): Run | undefined {
  const existing = runs.get(id);
  if (!existing) return undefined;
  const next = { ...existing, ...patch };
  runs.set(id, next);
  return next;
}
