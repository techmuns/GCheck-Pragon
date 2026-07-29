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

/** Who the brief is about, for a director subject. A person's name is not an
 *  identity, so the model is told the DIN when there is one — and told just as
 *  plainly when there isn't, because that changes what may honestly be
 *  concluded from everything below it. */
function identityLines(subject: Subject): string[] {
  if (subject.type !== "director") return [];
  if (!subject.din) {
    return [
      "SUBJECT IDENTITY: NOT ESTABLISHED — no unique registry record matched this name. Every item below is a name match and may concern a different person of the same name.",
    ];
  }
  const companies = (subject.anchors ?? []).slice(0, 5).join(", ");
  return [`SUBJECT IDENTITY: DIN ${subject.din}${companies ? ` — companies on record: ${companies}` : ""}`];
}

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
    const enhanced = await enhanceRedFlagSummary(det, subject, collected);
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
  collected: CollectorResult[],
): Promise<NonNullable<Run["brief"]>> {
  // The SDK defaults to a 10-minute timeout and two retries — half an hour in
  // the worst case, during which the run sits at "running" and the user watches
  // a spinner. A brief that falls back to the deterministic summary in 40s beats
  // an AI one that may never arrive.
  const client = new OpenAI({ apiKey: env.openaiApiKey, timeout: 40_000, maxRetries: 1 });
  const validRefs = new Set(det.citations.map((c) => c.ref));

  // Evidence that matched the subject's NAME but could not be tied to their
  // identity (their DIN, or a company they sit on). The deterministic sections
  // already demote these; the distinction has to survive into the prompt too,
  // or the model writes a namesake's fraud case up as the subject's.
  const nameOnly = new Set(
    collected.flatMap((c) => c.hits.filter((h) => h.confidence === "unverified").map((h) => h.url ?? h.title)),
  );

  // What each cited article turned out to say, once it was actually opened.
  // Keyed by URL so it can be attached to the citation it belongs to — the
  // citation numbering stays the deterministic brief's, which is what keeps
  // every [ref] in the output checkable.
  const insightByUrl = new Map<string, Record<string, unknown>>();
  for (const c of collected) {
    for (const h of c.hits) {
      if (h.extra?.category !== "insight" || !h.url) continue;
      insightByUrl.set(h.url, { ...h.extra, what: h.title, quote: h.snippet });
    }
  }

  // The evidence the model may cite — exactly the brief's real citations. A
  // title alone was never enough to write from: it says a matter exists and
  // nothing about what it was or who was on which side of it.
  const evidenceLines = det.citations
    .map((c) => {
      const caveat = nameOnly.has(c.url ?? c.label) ? "  ⚠ NAME MATCH ONLY — not confirmed as the subject" : "";
      const insight = c.url ? insightByUrl.get(c.url) : undefined;
      const detail = insight
        ? "\n    " +
          [
            `READ IN FULL: ${insight.what}`,
            insight.subjectRole ? `subject's role: ${insight.subjectRole}` : "",
            insight.authority ? `authority: ${insight.authority}` : "",
            insight.status ? `status: ${insight.status}` : "",
            insight.amount ? `amount: ${insight.amount}` : "",
            insight.polarity ? `polarity: ${insight.polarity}` : "",
          ]
            .filter(Boolean)
            .join(" · ")
        : "";
      return `[${c.ref}] (${c.sourceName}) ${c.label}${caveat}${detail}`;
    })
    .join("\n");

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
    "7. Evidence marked 'NAME MATCH ONLY' concerns someone who shares the subject's name and may not be them. Never write it as something the subject did, and never let it set the severity. Mention it at most once, as 'info', worded as unconfirmed.",
    "8. If SUBJECT IDENTITY says it was not established, say so in the headline — the reader must know the brief could not confirm which person of that name it covers.",
    "9. Where the evidence gives the subject's ROLE in a matter (complainant, petitioner, accused, defendant, respondent), the finding MUST state it. 'X filed a suit alleging Y' and 'X was sued for Y' are opposite facts; never write one for the other. A complainant is not accused of the thing they complained about, and their severity must reflect that. Where the role is given as 'unclear' or 'not_mentioned', say the matter names X without stating their role, and keep it as 'info'.",
    "10. Evidence marked READ IN FULL was opened and read; its wording is what the article actually says. Prefer it over the headline beside it, which is only a title.",
  ].join("\n");

  const user = [
    `SUBJECT: ${subject.company}${subject.promoters.length ? ` (promoters: ${subject.promoters.join(", ")})` : ""}`,
    ...identityLines(subject),
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
