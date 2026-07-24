import OpenAI from "openai";
import type { AppConfig, Run, Severity, Subject, CollectorResult, RenderedSection, Finding } from "./types";
import { env, hasOpenAI } from "./collectors/env";
import { assembleBrief } from "./assemble";
import { buildEvidence, evidenceForPrompt, type Evidence } from "./evidence";

// ── AI synthesis (Phase 3) ─────────────────────────────────────────────────
// Normalises the collected data into evidence, then asks OpenAI to write the
// one-page brief over it. Guardrails:
//   • the model may cite only refs that exist in the evidence (validated here)
//   • unavailable sources never raise the verdict (recomputed here, not trusted)
//   • no key, or any failure → deterministic assembler fallback (never breaks)

const VALID_SEVERITIES: Severity[] = ["red", "amber", "clear", "info"];

export async function synthesizeBrief(
  subject: Subject,
  collected: CollectorResult[],
  config: AppConfig,
): Promise<NonNullable<Run["brief"]>> {
  const evidence = buildEvidence(subject, collected);

  if (!hasOpenAI()) {
    // Deterministic path — already honest and source-linked.
    return { ...assembleBrief(subject, collected, config), synthesizedBy: "rules" };
  }

  try {
    const brief = await synthesizeWithOpenAI(evidence, config);
    return { ...brief, synthesizedBy: "ai" };
  } catch (err) {
    // Any model/parse/validation failure falls back — the brief still ships.
    console.error("[synthesize] OpenAI synthesis failed, using deterministic assembler:", err);
    return { ...assembleBrief(subject, collected, config), synthesizedBy: "rules" };
  }
}

async function synthesizeWithOpenAI(evidence: Evidence, config: AppConfig): Promise<NonNullable<Run["brief"]>> {
  const client = new OpenAI({ apiKey: env.openaiApiKey });

  const sections = config.sections.filter((s) => s.enabled).sort((a, b) => a.order - b.order);
  const sectionTitles = sections.map((s) => s.title);
  const validRefs = new Set(evidence.citations.map((c) => c.ref));

  const userPrompt = [
    evidenceForPrompt(evidence, sectionTitles),
    "",
    "Return the brief as JSON matching the provided schema. Section 'id' values must be exactly these, in order:",
    sections.map((s) => `  "${s.id}" -> ${s.title}`).join("\n"),
  ].join("\n");

  const completion = await client.chat.completions.create({
    model: env.openaiModel,
    temperature: 0.2,
    messages: [
      { role: "system", content: config.synthesisPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "partner_brief",
        strict: true,
        schema: briefSchema(sections.map((s) => s.id)),
      },
    },
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) throw new Error("Empty completion");
  const parsed = JSON.parse(raw) as ModelBrief;

  return validateAndBuild(parsed, evidence, sections, validRefs);
}

// ── Validation — the model output is never trusted verbatim ─────────────────

interface ModelFinding {
  severity: string;
  text: string;
  sourceRef?: number | null;
}
interface ModelSection {
  id: string;
  findings: ModelFinding[];
}
interface ModelBrief {
  headline: string;
  sections: ModelSection[];
}

export function validateAndBuild(
  model: ModelBrief,
  evidence: Evidence,
  sections: AppConfig["sections"],
  validRefs: Set<number>,
): NonNullable<Run["brief"]> {
  const byId = new Map(model.sections.map((s) => [s.id, s]));

  const rendered: RenderedSection[] = sections.map((sec) => {
    const modelSec = byId.get(sec.id);
    const findings: Finding[] = (modelSec?.findings ?? [])
      .map((f): Finding | null => {
        const severity = (VALID_SEVERITIES.includes(f.severity as Severity) ? f.severity : "info") as Severity;
        const text = String(f.text ?? "").trim();
        if (!text) return null;
        // Drop any ref the model invented — only real citations survive.
        const sourceRef = typeof f.sourceRef === "number" && validRefs.has(f.sourceRef) ? f.sourceRef : undefined;
        return { severity, text, sourceRef };
      })
      .filter((f): f is Finding => f !== null);

    return { id: sec.id, title: sec.title, findings, empty: findings.length === 0 };
  });

  // Verdict is recomputed from validated findings — the model never sets it.
  // Unavailable sources (info) can't raise it.
  const rank: Record<Severity, number> = { red: 3, amber: 2, clear: 1, info: 0 };
  let verdict: Severity = "clear";
  let anyRisk = false;
  for (const s of rendered) {
    for (const f of s.findings) {
      if (f.severity === "info") continue;
      anyRisk = true;
      if (rank[f.severity] > rank[verdict]) verdict = f.severity;
    }
  }
  if (!anyRisk) verdict = evidence.anyCompleted ? "clear" : "info";

  const headline = String(model.headline ?? "").trim() || fallbackHeadline(verdict, evidence.subject.company);

  return { verdict, headline, sections: rendered, citations: evidence.citations };
}

function fallbackHeadline(verdict: Severity, company: string): string {
  switch (verdict) {
    case "red":
      return `Red flags found for ${company} — review before the meeting.`;
    case "amber":
      return `${company}: items to review before the meeting.`;
    case "clear":
      return `No red flags surfaced for ${company}.`;
    default:
      return `Pre-screen for ${company} — limited sources ran.`;
  }
}

// JSON schema for structured output. Section ids are constrained to the enabled set.
function briefSchema(sectionIds: string[]) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["headline", "sections"],
    properties: {
      headline: { type: "string" },
      sections: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "findings"],
          properties: {
            id: { type: "string", enum: sectionIds },
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
        },
      },
    },
  };
}
