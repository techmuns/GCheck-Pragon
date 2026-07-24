import OpenAI from "openai";
import type { AppConfig, Run, Severity, Subject, CollectorResult, Finding } from "./types";
import { env, hasOpenAI } from "./collectors/env";
import { assembleBrief } from "./assemble";

// ── AI synthesis (hybrid) ──────────────────────────────────────────────────
// The deterministic assembler fills every section reliably (each case under
// Litigation, each article under Press, locked sources as Upgrade, real
// citations). OpenAI then rewrites ONLY the Red-Flag Summary + headline over
// those same citations — the analytical distillation a partner reads first.
//
// Guardrails: the model may cite only refs that already exist; the verdict is
// recomputed from findings; any failure falls back to the pure deterministic
// brief, so a brief always ships.

const VALID_SEVERITIES: Severity[] = ["red", "amber", "clear", "info"];
const RANK: Record<Severity, number> = { red: 3, amber: 2, clear: 1, info: 0 };

export async function synthesizeBrief(
  subject: Subject,
  collected: CollectorResult[],
  config: AppConfig,
): Promise<NonNullable<Run["brief"]>> {
  // Deterministic brief — all sections + citations, always correct.
  const det = assembleBrief(subject, collected, config);

  if (!hasOpenAI()) {
    return { ...det, synthesizedBy: "rules" };
  }

  try {
    const enhanced = await enhanceRedFlagSummary(det, subject);
    return { ...enhanced, synthesizedBy: "ai" };
  } catch (err) {
    console.error("[synthesize] OpenAI enhancement failed, using deterministic brief:", err);
    return { ...det, synthesizedBy: "rules" };
  }
}

// Ask OpenAI to write the Red-Flag Summary + headline over the deterministic
// brief's citations, then splice it back in.
async function enhanceRedFlagSummary(
  det: NonNullable<Run["brief"]>,
  subject: Subject,
): Promise<NonNullable<Run["brief"]>> {
  const client = new OpenAI({ apiKey: env.openaiApiKey });
  const validRefs = new Set(det.citations.map((c) => c.ref));

  // The evidence the model may cite — exactly the brief's real citations.
  const evidenceLines = det.citations.map((c) => `[${c.ref}] (${c.sourceName}) ${c.label}`).join("\n");

  const system = [
    "You are a governance due-diligence analyst writing the RED-FLAG SUMMARY that leads a one-page pre-meeting brief for investment partners.",
    "You are given a numbered list of EVIDENCE (real sources already gathered). Write the summary using ONLY this evidence.",
    "Rules:",
    "1. Every finding must cite one [ref] number from the evidence. Never cite a ref that is not listed. Never invent facts.",
    "2. Severity: 'red' = serious governance risk (fraud, wilful default, criminal/CBI/EOW, suit-filed defaulter); 'amber' = review-worthy (litigation, adverse press, keyword hits); 'clear' = verified clean; 'info' = context.",
    "3. Lead with the sharpest risks. One tight sentence per finding — a partner reads this in under a minute.",
    "4. If the evidence shows no genuine red or amber risk, return a single 'clear' finding saying so.",
    "5. Also return a one-line headline summarising the overall picture for this subject.",
  ].join("\n");

  const user = [
    `SUBJECT: ${subject.company}${subject.promoters.length ? ` (promoters: ${subject.promoters.join(", ")})` : ""}`,
    "",
    "EVIDENCE (cite by [ref]):",
    evidenceLines || "(no evidence gathered)",
  ].join("\n");

  const completion = await client.chat.completions.create({
    model: env.openaiModel,
    temperature: 0.2,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "red_flag_summary", strict: true, schema: summarySchema() },
    },
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) throw new Error("Empty completion");
  const parsed = JSON.parse(raw) as { headline: string; findings: ModelFinding[] };

  // Validate the model's findings — drop invented refs, coerce severities.
  const findings: Finding[] = (parsed.findings ?? [])
    .map((f): Finding | null => {
      const severity = (VALID_SEVERITIES.includes(f.severity as Severity) ? f.severity : "info") as Severity;
      const text = String(f.text ?? "").trim();
      if (!text) return null;
      const sourceRef = typeof f.sourceRef === "number" && validRefs.has(f.sourceRef) ? f.sourceRef : undefined;
      return { severity, text, sourceRef };
    })
    .filter((f): f is Finding => f !== null);

  if (findings.length === 0) throw new Error("No valid red-flag findings from model");

  // Splice the AI summary into the deterministic brief.
  const sections = det.sections.map((s) =>
    s.id === "red-flags" ? { ...s, findings, empty: false } : s,
  );

  // Recompute the verdict from all validated findings.
  let verdict: Severity = "clear";
  let anyRisk = false;
  for (const s of sections) {
    for (const f of s.findings) {
      if (f.severity === "info") continue;
      anyRisk = true;
      if (RANK[f.severity] > RANK[verdict]) verdict = f.severity;
    }
  }
  if (!anyRisk) verdict = det.verdict === "info" ? "info" : "clear";

  const headline = String(parsed.headline ?? "").trim() || det.headline;

  return { verdict, headline, sections, citations: det.citations };
}

interface ModelFinding {
  severity: string;
  text: string;
  sourceRef?: number | null;
}

function summarySchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["headline", "findings"],
    properties: {
      headline: { type: "string" },
      findings: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["severity", "text", "sourceRef"],
          properties: {
            severity: { type: "string", enum: VALID_SEVERITIES },
            text: { type: "string" },
            sourceRef: { type: ["integer", "null"] },
          },
        },
      },
    },
  };
}
