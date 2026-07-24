import { getConfig, updateRun } from "./store";
import type { Run, RenderedSection, Citation, Severity } from "./types";

// ── Mocked research workflow (Phase 1) ─────────────────────────────────────
// Simulates the multi-source retrieval + synthesis so the input→output shell
// works end to end. Phase 2 replaces the per-source steps with real collectors
// (Google + Indian Kanoon APIs, PrivateCircle + CIBIL via Playwright); Phase 3
// swaps the mock brief for an OpenAI-synthesised one.

const STEP_MS = 900;

export async function runMockWorkflow(runId: string): Promise<void> {
  const config = await getConfig();
  updateRun(runId, { status: "running" });

  const run = () => updateRun(runId, {}); // no-op fetch helper
  void run;

  const enabledSources = config.sources.filter((s) => s.enabled);

  // Advance each source in sequence with a small delay.
  for (let i = 0; i < enabledSources.length; i++) {
    await delay(STEP_MS);
    updateRun(runId, {
      progress: buildProgress(runId, i, "running"),
    });
    await delay(STEP_MS);
    updateRun(runId, {
      progress: buildProgress(runId, i, "done"),
    });
  }

  // Synthesise a mock brief in the design-system shape.
  await delay(STEP_MS);
  const brief = buildMockBrief(runId);
  updateRun(runId, { status: "complete", brief });
}

function buildProgress(runId: string, upTo: number, state: "running" | "done") {
  const existing = getProgress(runId);
  return existing.map((p, idx) => {
    if (idx < upTo) return { ...p, status: "done" as const, hits: p.hits ?? 0 };
    if (idx === upTo) return { ...p, status: state, hits: state === "done" ? mockHits(idx) : p.hits };
    return p;
  });
}

function getProgress(runId: string) {
  // Read current progress off the store via updateRun's return.
  const r = updateRun(runId, {});
  return r?.progress ?? [];
}

function mockHits(idx: number): number {
  return [3, 5, 8, 2][idx % 4];
}

function delay(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

// ── Mock brief builder ─────────────────────────────────────────────────────

function buildMockBrief(runId: string): NonNullable<Run["brief"]> {
  const citations: Citation[] = [
    { ref: 1, sourceName: "Indian Kanoon", label: "Sample matter — civil suit (illustrative)", url: "https://indiankanoon.org" },
    { ref: 2, sourceName: "Google / News", label: "Illustrative press mention", url: "https://www.google.com" },
    { ref: 3, sourceName: "PrivateCircle", label: "Director profile (illustrative)", url: "https://www.privatecircle.co" },
  ];

  const sections: RenderedSection[] = [
    {
      id: "red-flags",
      title: "Red-Flag Summary",
      findings: [
        { severity: "amber" as Severity, text: "Sample keyword hit on a promoter name — needs manual review before the meeting.", sourceRef: 2 },
        { severity: "clear" as Severity, text: "No suit-filed / wilful-defaulter records surfaced in the illustrative run." },
      ],
    },
    {
      id: "snapshot",
      title: "Company Snapshot",
      findings: [{ severity: "info" as Severity, text: "Placeholder snapshot — real company profile arrives with the Phase 2 retrieval engine." }],
    },
    {
      id: "litigation",
      title: "Litigation (Indian Kanoon)",
      findings: [{ severity: "amber" as Severity, text: "One illustrative civil matter captured (heading + link).", sourceRef: 1 }],
    },
    {
      id: "directorships",
      title: "Directorships (PrivateCircle)",
      findings: [{ severity: "info" as Severity, text: "Directorship graph will populate here once PrivateCircle is wired.", sourceRef: 3 }],
    },
  ];

  void runId;
  return {
    verdict: "amber",
    headline: "Illustrative pre-screen — one amber flag for manual review, no defaulter records.",
    sections,
    citations,
  };
}
