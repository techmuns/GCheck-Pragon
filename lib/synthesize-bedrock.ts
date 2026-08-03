import type { Run, Severity, Subject, Finding } from "./types";
import { env } from "./collectors/env";

// ── AI synthesis (Claude via AWS Bedrock) ──────────────────────────────────
// Alternate backend for the same job lib/synthesize.ts's OpenAI path does:
// rewrite the Red-Flag Summary + headline over the deterministic brief's
// existing citations. Selected only when LLM_PROVIDER=claude (see
// lib/collectors/env.ts); the OpenAI path is untouched and remains the
// default. This file is self-contained — deleting it plus the toggle branch
// in lib/synthesize.ts fully removes the Claude path.
//
// Same guardrails as the OpenAI path: the model may cite only refs that
// already exist; the verdict is recomputed from findings; any failure falls
// back to the pure deterministic brief. Returns the exact same brief shape
// as the OpenAI path so no caller can tell which provider ran.

const VALID_SEVERITIES: Severity[] = ["red", "amber", "clear", "info"];
const RANK: Record<Severity, number> = { red: 3, amber: 2, clear: 1, info: 0 };

export function hasClaudeBedrock(): boolean {
  return Boolean(env.claudeBedrockApiKey);
}

export async function synthesizeBriefWithClaude(
  subject: Subject,
  det: NonNullable<Run["brief"]>,
): Promise<NonNullable<Run["brief"]>> {
  if (!hasClaudeBedrock()) {
    return { ...det, synthesizedBy: "rules" };
  }

  try {
    const enhanced = await enhanceRedFlagSummaryClaude(det, subject);
    return { ...enhanced, synthesizedBy: "ai" };
  } catch (err) {
    console.error("[synthesize-bedrock] Claude enhancement failed, using deterministic brief:", err);
    return { ...det, synthesizedBy: "rules" };
  }
}

interface ModelFinding {
  severity: string;
  text: string;
  sourceRef?: number | null;
}

// Ask Claude (via Bedrock's Converse API) to write the Red-Flag Summary +
// headline over the deterministic brief's citations, then splice it back in.
async function enhanceRedFlagSummaryClaude(
  det: NonNullable<Run["brief"]>,
  subject: Subject,
): Promise<NonNullable<Run["brief"]>> {
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
    "4. Write in PLAIN ENGLISH a busy, non-lawyer partner understands instantly. No legalese, no jargon, no long clauses. Say what happened and why it matters.",
    "5. If the evidence shows no genuine red or amber risk, return a single 'clear' finding saying so.",
    "6. Also return a one-line headline in plain English summarising the overall picture for this subject.",
    "You must call the red_flag_summary tool exactly once with your answer — do not respond in plain text.",
  ].join("\n");

  const user = [
    `SUBJECT: ${subject.company}${subject.promoters.length ? ` (promoters: ${subject.promoters.join(", ")})` : ""}`,
    "",
    "EVIDENCE (cite by [ref]):",
    evidenceLines || "(no evidence gathered)",
  ].join("\n");

  const region = env.claudeBedrockRegion;
  const modelId = env.claudeBedrockModelId;
  const url = `https://bedrock-runtime.${region}.amazonaws.com/model/${encodeURIComponent(modelId)}/converse`;

  const body = {
    system: [{ text: system }],
    messages: [{ role: "user", content: [{ text: user }] }],
    inferenceConfig: { temperature: 0.2 },
    toolConfig: {
      tools: [
        {
          toolSpec: {
            name: "red_flag_summary",
            description: "Return the red-flag summary headline and findings.",
            inputSchema: { json: summarySchema() },
          },
        },
      ],
      toolChoice: { tool: { name: "red_flag_summary" } },
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.claudeBedrockApiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Bedrock request failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  const content: Array<{ toolUse?: { name: string; input: unknown } }> = data?.output?.message?.content ?? [];
  const toolUse = content.find((c) => c.toolUse?.name === "red_flag_summary")?.toolUse;
  if (!toolUse) throw new Error("No red_flag_summary tool call in Bedrock response");

  const parsed = toolUse.input as { headline: string; findings: ModelFinding[] };

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
