import OpenAI from "openai";
import { callBedrockStructured } from "./bedrock.mjs";
import { env, llmProviderChain } from "./collectors/env";
import type { Run } from "./types";

// ── The completeness critic ─────────────────────────────────────────────────
// A report's worst failure is silent: a lead sitting in the collected evidence
// that nobody chased. The manual analysts we benchmarked against caught these
// by rereading their own notes; this pass does the same — after the brief is
// written, it reads the raw evidence and asks one question: what does this
// data raise that the report has not answered?
//
// The output is a short "Leads not yet chased" list. It is deliberately a
// research agenda, not findings: nothing here touches the score or the
// verdict, and every lead must quote the evidence line that raised it — a
// lead the corpus cannot support is dropped, exactly as in the judgment
// reader. The report telling the reader what IT still wants to know is the
// difference between a search log and an analyst.

const MAX_LEADS = 5;

const SCHEMA = {
  type: "object",
  properties: {
    leads: {
      type: "array",
      maxItems: MAX_LEADS,
      items: {
        type: "object",
        properties: {
          question: { type: "string", description: "One concrete, checkable question the evidence raises but the report does not answer." },
          because: { type: "string", description: "Verbatim fragment from the evidence (>=25 chars) that raises it." },
        },
        required: ["question", "because"],
        additionalProperties: false,
      },
    },
  },
  required: ["leads"],
  additionalProperties: false,
} as const;

interface RawLeads {
  leads?: Array<{ question?: string; because?: string }>;
}

/** The evidence, flattened and bounded. */
function corpusOf(run: Run): string {
  const lines: string[] = [];
  for (const c of run.collected ?? []) {
    for (const h of c.hits.slice(0, 30)) lines.push(`[${c.sourceName}] ${h.title} ${h.snippet ?? ""}`);
    if (c.note) lines.push(`[${c.sourceName}] note: ${c.note}`);
  }
  for (const p of run.diligence ?? []) {
    for (const f of p.concerns.slice(0, 10)) lines.push(`[Board: ${p.name}] ${f.text}`);
  }
  for (const r of run.related ?? []) lines.push(`[Related: ${r.entity} via ${r.via.join(",")}] ${r.title}`);
  return lines.join("\n").slice(0, 24_000);
}

function flat(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Keep only leads the corpus actually raised. Exported for the checks. */
export function validateLeads(raw: RawLeads, corpus: string): string[] {
  const body = flat(corpus);
  const out: string[] = [];
  for (const l of raw.leads ?? []) {
    const q = l.question?.trim();
    const because = l.because?.trim() ?? "";
    if (!q || flat(because).length < 25) continue;
    if (!body.includes(flat(because))) continue;
    if (!out.includes(q)) out.push(q);
    if (out.length >= MAX_LEADS) break;
  }
  return out;
}

const SYSTEM = [
  "You review governance pre-screens for a private-equity team.",
  "You are given the raw evidence a run collected. Name what the evidence RAISES that a reader would still need answered — an entity mentioned but never screened, a case with no outcome, a regulator named in passing, a money trail that stops.",
  "Each lead must be one concrete checkable question, and must carry a verbatim fragment of the evidence that raises it, copied exactly.",
  "Never invent facts, never restate findings the report already carries, and return no lead when the evidence is genuinely exhausted.",
].join(" ");

export async function findLeads(run: Run, onNote?: (n: string) => void): Promise<string[]> {
  const corpus = corpusOf(run);
  if (corpus.length < 200) return [];
  const user = `Subject: ${run.subject.company}\n\nEvidence collected:\n${corpus}`;

  for (const provider of llmProviderChain()) {
    try {
      let raw: RawLeads;
      if (provider === "bedrock") {
        const { data } = await callBedrockStructured<RawLeads>({
          system: SYSTEM,
          user,
          toolName: "report_leads",
          toolDescription: "Report open leads the evidence raises.",
          schema: SCHEMA as unknown as Record<string, unknown>,
          maxTokens: 900,
        });
        raw = data;
      } else {
        const client = new OpenAI({ apiKey: env.openaiApiKey, timeout: 40_000, maxRetries: 1 });
        const res = await client.chat.completions.create({
          model: env.openaiModel,
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: `${SYSTEM} Reply with JSON matching: ${JSON.stringify(SCHEMA)}` },
            { role: "user", content: user },
          ],
        });
        raw = JSON.parse(res.choices[0]?.message?.content ?? "{}") as RawLeads;
      }
      return validateLeads(raw, corpus);
    } catch (err) {
      onNote?.(`Lead review via ${provider} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return [];
}
