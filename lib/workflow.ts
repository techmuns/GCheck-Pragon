import { getConfig, updateRun, getRun } from "./store";
import { collectors, type CollectorContext } from "./collectors";
import { resolveIdentity } from "./collectors/directors";
import { synthesizeBrief } from "./synthesize";
import type { CollectorResult, SourceProgress, Subject } from "./types";

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

/** The director identity lookup runs BEFORE the sources, so every second it
 *  takes is a second the whole run waits. Kept short deliberately: anchors are
 *  worth waiting a little for, never worth stalling the brief over. */
const IDENTIFY_DEADLINE_MS = 25000;

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

  // Settle WHO a director subject is before any source runs. The collectors fan
  // out concurrently below, so a DIN discovered inside one of them arrives too
  // late to be of use to the others — the identity has to be on the subject
  // before the fan-out, or every sweep is still searching a bare name.
  const subject = run.subject.type === "director" ? await identify(run.subject) : run.subject;
  if (subject !== run.subject) updateRun(runId, { subject });

  const ctx: CollectorContext = { subject, keywords: enabledKeywords };

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

/**
 * Resolve a director to their registry identity — a DIN, and the companies they
 * actually sit on — and hang it on the subject for every collector to use.
 *
 * Deliberately non-fatal. A slow or unreachable registry costs the run its
 * anchors, not the run itself: the sweeps fall back to searching the name, and
 * the registry collector reports the miss so the brief never implies more
 * certainty about *which* person it covers than we have.
 */
async function identify(subject: Subject): Promise<Subject> {
  try {
    const identity = await withDeadline(
      resolveIdentity({ name: subject.company, din: subject.din, anchorCompany: subject.anchors?.[0] }),
      "Director identity lookup",
      IDENTIFY_DEADLINE_MS,
    );
    if (!identity) return subject;
    return {
      ...subject,
      // The registry's spelling wins — and a DIN-only search had no name at all
      // until this point, so this is where it gets one.
      company: identity.chosen.name || subject.company,
      din: identity.chosen.din,
      anchors: identity.chosen.companies.length > 0 ? identity.chosen.companies : subject.anchors,
    };
  } catch {
    return subject;
  }
}

/** Resolve with the collector, or reject once the deadline passes. The
 *  collector keeps running in the background if it ever does come back; it just
 *  no longer holds up the brief. */
function withDeadline<T>(work: Promise<T>, sourceName: string, ms: number = SOURCE_DEADLINE_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${sourceName} did not respond within ${Math.round(ms / 1000)}s.`)),
      ms,
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
