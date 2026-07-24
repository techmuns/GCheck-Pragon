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

export async function runWorkflow(runId: string): Promise<void> {
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
        const result = await collector(ctx);
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

function setProgress(runId: string, sourceId: string, patch: Partial<SourceProgress>): void {
  const run = getRun(runId);
  if (!run) return;
  const progress = run.progress.map((p) => (p.sourceId === sourceId ? { ...p, ...patch } : p));
  updateRun(runId, { progress });
}
