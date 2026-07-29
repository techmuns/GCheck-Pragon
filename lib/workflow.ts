import { getConfig, updateRun, getRun } from "./store";
import { collectors, type CollectorContext } from "./collectors";
import { resolveIdentity } from "./collectors/directors";
import { resolveDirector } from "./collectors/indiafilings";
import { synthesizeBrief } from "./synthesize";
import type { CollectorResult, RunEvent, SourceProgress, Subject } from "./types";

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
  const subject = run.subject.type === "director" ? await identify(runId, run.subject) : run.subject;
  if (subject !== run.subject) updateRun(runId, { subject });

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

      // Each collector narrates into the shared log under its own id, so the
      // activity panel can attribute every line without the collector knowing
      // anything about runs or stores.
      const ctx: CollectorContext = {
        subject,
        keywords: enabledKeywords,
        emit: (text, meta) => appendEvent(runId, { level: meta?.level ?? "step", text, url: meta?.url, sourceId: source.id }),
      };

      try {
        const result = await withDeadline(collector(ctx), source.name);
        setProgress(runId, source.id, {
          status: result.status,
          hits: result.hits.length,
          note: result.note,
        });
        appendEvent(runId, {
          level: result.status === "done" ? "step" : "skip",
          sourceId: source.id,
          text: `${source.name}: ${result.status}${result.hits.length ? ` — ${result.hits.length} result(s)` : ""}`,
        });
        return result;
      } catch (err) {
        const note = err instanceof Error ? err.message : String(err);
        setProgress(runId, source.id, { status: "error", note });
        appendEvent(runId, { level: "warn", sourceId: source.id, text: `${source.name} failed — ${note}` });
        return { sourceId: source.id, sourceName: source.name, kind: source.kind, status: "error", note, hits: [] };
      }
    }),
  );

  updateRun(runId, { collected: results });

  // Synthesise the brief (OpenAI when configured, deterministic fallback else).
  // Note this takes the RESOLVED subject, not the one the run started with: the
  // identity settled above is exactly what the brief needs to say who it covers.
  try {
    appendEvent(runId, { level: "step", text: "Writing the brief" });
    const brief = await synthesizeBrief(subject, results, config);
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
async function identify(runId: string, subject: Subject): Promise<Subject> {
  const query = { name: subject.company, din: subject.din, anchorCompany: subject.anchors?.[0] };
  appendEvent(runId, {
    level: "step",
    text: subject.din ? `Resolving DIN ${subject.din} against the MCA register` : `Resolving "${subject.company}" against the MCA register`,
  });

  // The MCA register goes first. With a DIN it needs a single keyless GET and
  // returns the full entity list, where the older aggregator route costs a
  // search and often finds nothing at all.
  try {
    const record = await withDeadline(resolveDirector(query), "Registry identity lookup", IDENTIFY_DEADLINE_MS);
    if (record) {
      appendEvent(runId, {
        level: "step",
        text: `Identified ${record.name} (DIN ${record.din}) — ${record.entities.length} entities on record`,
        url: record.url,
      });
      // Live entities first. Only the first few anchors reach the search
      // queries, and a struck-off shell from 2007 makes a far worse query than
      // the company the person actually runs today.
      const ordered = [...record.entities].sort((a, b) => rankStanding(a.status) - rankStanding(b.status));
      return {
        ...subject,
        company: record.name || subject.company,
        din: record.din,
        anchors: ordered.length > 0 ? ordered.map((e) => e.name) : subject.anchors,
      };
    }
    appendEvent(runId, { level: "skip", text: "No MCA record matched — trying the aggregator" });
  } catch {
    appendEvent(runId, { level: "warn", text: "MCA register did not answer in time — trying the aggregator" });
  }

  try {
    const identity = await withDeadline(resolveIdentity(query), "Director identity lookup", IDENTIFY_DEADLINE_MS);
    if (!identity) {
      appendEvent(runId, {
        level: "warn",
        text: "Identity not established — findings will be name-matched and cannot raise the verdict",
      });
      return subject;
    }
    appendEvent(runId, {
      level: "step",
      text: `Identified ${identity.chosen.name} (DIN ${identity.chosen.din}) from the aggregator record`,
      url: identity.chosen.url,
    });
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

/** Sort key for an entity's registry standing: active first, dead last. */
function rankStanding(status?: string): number {
  if (!status) return 1;
  if (/active/i.test(status)) return 0;
  if (/strike|liquidat|dissolv|defunct|amalgamat/i.test(status)) return 2;
  return 1;
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

/** Keep the log bounded: a deep run over a dozen entities emits a lot, and the
 *  whole array ships on every 500ms poll. The oldest lines go first. */
const MAX_EVENTS = 500;

/**
 * Append one line to the run's activity log.
 *
 * Deliberately synchronous, and it must stay that way. Every collector runs
 * concurrently and `updateRun` replaces the whole run object, so an `await`
 * between reading `run.events` and writing the new array would let a sibling
 * collector's line land in between and be overwritten. No I/O belongs here.
 */
function appendEvent(runId: string, event: Omit<RunEvent, "at">): void {
  const run = getRun(runId);
  if (!run) return;
  const events = [...(run.events ?? []), { ...event, at: new Date().toISOString() }];
  updateRun(runId, { events: events.slice(-MAX_EVENTS) });
}
