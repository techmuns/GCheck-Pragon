import { getConfig, updateRun, getRun } from "./store";
import { collectors, type CollectorContext } from "./collectors";
import { synthesizeBrief } from "./synthesize";
import type { CollectorResult, SourceProgress } from "./types";

// ── Research workflow (Phase 2) ────────────────────────────────────────────
// Real multi-source retrieval. For the run's subject + enabled keywords it runs
// every enabled source's collector concurrently, streaming per-source progress,
// then assembles an honest, source-linked brief.
//
// Phase 3 will replace `assembleBrief` with OpenAI narrative synthesis over the
// same collected data.

/** Hard cap on any one source. Every collector already times out its own HTTP
 *  calls, but a source that retries or redirects can still stack those timeouts
 *  into minutes. The run must always finish, so a source that overruns is
 *  recorded as unreachable and the rest of the brief goes ahead without it. */
const SOURCE_DEADLINE_MS = Number(process.env.SOURCE_DEADLINE_SECONDS ?? 75) * 1000;

export async function runWorkflow(runId: string): Promise<void> {
  // Everything below runs detached from the request that started it, so an
  // escaping throw would surface as an unhandled rejection and — worse — leave
  // the run sitting at "queued" while the UI polls it forever.
  try {
    await execute(runId);
  } catch (err) {
    console.error("[workflow] run failed:", err);
    updateRun(runId, {
      status: "error",
      error: err instanceof Error ? err.message : "The pre-screen failed to run.",
    });
  }
}

async function execute(runId: string): Promise<void> {
  const config = await getConfig();
  updateRun(runId, { status: "running" });

  const enabledKeywords = config.keywords.filter((k) => k.enabled).map((k) => k.term);
  const enabledSources = config.sources.filter((s) => s.enabled);

  const run = getRun(runId);
  if (!run) return;

  const ctx: CollectorContext = { subject: run.subject, keywords: enabledKeywords };

  // Run each collector concurrently, updating its progress line as it resolves.
  const results = await Promise.all(
    enabledSources.map(async (source): Promise<CollectorResult> => {
      // Locked (paid) sources are shown as "Upgrade required", never run.
      if (source.locked) {
        const note = source.lockReason ?? "Upgrade required.";
        setProgress(runId, source.id, { status: "locked", note });
        return { sourceId: source.id, sourceName: source.name, kind: source.kind, status: "locked", note, hits: [] };
      }
      setProgress(runId, source.id, { status: "running" });
      const collector = collectors[source.id];
      if (!collector) {
        const r: CollectorResult = {
          sourceId: source.id,
          sourceName: source.name,
          kind: source.kind,
          status: "skipped",
          note: "No collector registered for this source.",
          hits: [],
        };
        setProgress(runId, source.id, { status: "skipped", note: r.note });
        return r;
      }
      try {
        const result = await withDeadline(collector(ctx), source.name);
        setProgress(runId, source.id, {
          status: result.status,
          hits: result.hits.length,
          note: result.note,
        });
        return result;
      } catch (err) {
        const note = err instanceof Error ? err.message : String(err);
        setProgress(runId, source.id, { status: "error", note });
        return { sourceId: source.id, sourceName: source.name, kind: source.kind, status: "error", note, hits: [] };
      }
    }),
  );

  updateRun(runId, { collected: results });

  // Synthesise the brief (OpenAI when configured, deterministic fallback else).
  try {
    const brief = await synthesizeBrief(run.subject, results, config);
    updateRun(runId, { status: "complete", brief });
  } catch (err) {
    updateRun(runId, { status: "error", error: err instanceof Error ? err.message : "Failed to assemble the brief." });
  }
}

/** Resolve with the collector, or reject once the deadline passes. The
 *  collector keeps running in the background if it ever does come back; it just
 *  no longer holds up the brief. */
function withDeadline<T>(work: Promise<T>, sourceName: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${sourceName} did not respond within ${Math.round(SOURCE_DEADLINE_MS / 1000)}s.`)),
      SOURCE_DEADLINE_MS,
    );
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer)) as Promise<T>;
}

function setProgress(runId: string, sourceId: string, patch: Partial<SourceProgress>): void {
  const run = getRun(runId);
  if (!run) return;
  const progress = run.progress.map((p) => (p.sourceId === sourceId ? { ...p, ...patch } : p));
  updateRun(runId, { progress });
}
