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
    return JSON.parse(raw) as AppConfig;
  } catch {
    await saveConfig(defaultConfig);
    return defaultConfig;
  }
}

export async function saveConfig(config: AppConfig): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
}

// ── Run store (in-memory for Phase 1) ──────────────────────────────────────
// Persistence swaps in with the retrieval engine. A module-level Map survives
// across requests within the dev/server process.

const runs = new Map<string, Run>();

// Stable, non-random id (Math.random / Date.now are fine at runtime here, but
// we keep a simple monotonic counter for readability).
let seq = 0;
function newId(): string {
  seq += 1;
  return `run_${Date.now().toString(36)}_${seq}`;
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
