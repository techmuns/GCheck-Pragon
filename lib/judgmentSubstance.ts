import OpenAI from "openai";
import { callBedrockStructured } from "./bedrock.mjs";
import { env, llmProviderChain, type LlmProvider } from "./collectors/env";

// ── What the dispute is actually about ──────────────────────────────────────
// The header of a judgment is structured and can be parsed outright — court,
// parties, bench, number, date (lib/collectors/judgment.ts). The substance is
// not. Why the matter arose, what is being sought, how much is at stake and how
// it ended live in the prose, in whatever order the judge wrote them.
//
// So this is the one place in the pipeline that reads rather than parses. Two
// guards make that safe enough to put in a governance brief:
//
//   1. Money is extracted DETERMINISTICALLY, by regex, and the model is not
//      asked for it. A hallucinated ₹ figure in a diligence report is the worst
//      single failure this system could produce — it would be quoted in a
//      meeting as the exposure.
//   2. Every narrative field must be supported by a verbatim quote from the
//      judgment, and the quote is checked against the source text here. A
//      field whose quote is not in the document is dropped, not shown.
//
// A judgment that cannot be read this way keeps the header facts and loses
// nothing it previously had.

export interface JudgmentSubstance {
  /** Why the matter arose, in one or two plain sentences. */
  dispute?: string;
  /** What the party who started it asked the court for. */
  reliefSought?: string;
  /** How it ended, where the judgment says. */
  outcome?: string;
  /** What this means for the subject — the line a partner acts on. */
  stake?: string;
  /** Money the judgment names, read by regex and never by the model. */
  amounts: string[];
  /** The verbatim lines the fields above rest on, for checking. */
  evidence: string[];
}

/**
 * Sums as Indian judgments write them.
 *
 * Deliberately narrow: a bare number is not an amount, and "2024" is not two
 * thousand and twenty-four rupees. A currency marker or a scale word has to be
 * present, which is what keeps case numbers, years and paragraph numbers out.
 */
const AMOUNT_RE =
  /(?:(?:₹|Rs\.?|INR|USD|\$|EUR|€)\s?[\d,]+(?:\.\d+)?(?:\s?(?:crores?|crs?|lakhs?|lacs?|millions?|billions?|mn|bn))?)|(?:[\d,]+(?:\.\d+)?\s?(?:crores?|lakhs?|lacs?)\s?(?:rupees)?)/gi;

/** Every distinct sum the judgment names, in the order it names them. */
export function extractAmounts(text: string, limit = 8): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of text.matchAll(AMOUNT_RE)) {
    const raw = m[0].replace(/\s+/g, " ").trim();
    const key = raw.toLowerCase().replace(/[\s.]/g, "");
    // A lone "Rs" or a scale word with no number is noise.
    if (!/\d/.test(raw)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(raw);
    if (out.length >= limit) break;
  }
  return out;
}

/** Whitespace-insensitive containment — the reader's text and the model's quote
 *  will not agree about line breaks, and that is not a reason to drop a fact. */
function containsQuote(haystack: string, quote: string): boolean {
  const flat = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const q = flat(quote);
  if (q.length < 20) return false; // too short to be evidence of anything
  return flat(haystack).includes(q);
}

const SCHEMA = {
  type: "object",
  properties: {
    dispute: { type: "string", description: "Why the matter arose, 1-2 plain sentences, no legalese." },
    disputeQuote: { type: "string", description: "Verbatim sentence from the judgment supporting `dispute`." },
    reliefSought: { type: "string", description: "What the party who brought it asked the court for." },
    reliefQuote: { type: "string", description: "Verbatim sentence supporting `reliefSought`." },
    outcome: { type: "string", description: "How the court disposed of it, if the judgment says. Empty if not stated." },
    outcomeQuote: { type: "string", description: "Verbatim sentence supporting `outcome`." },
    stake: { type: "string", description: "One sentence: what this means commercially for the named subject." },
  },
  required: ["dispute", "disputeQuote"],
  additionalProperties: false,
} as const;

interface RawSubstance {
  dispute?: string;
  disputeQuote?: string;
  reliefSought?: string;
  reliefQuote?: string;
  outcome?: string;
  outcomeQuote?: string;
  stake?: string;
}

function systemPrompt(): string {
  return [
    "You read Indian court judgments for a governance pre-screen used in private-equity diligence.",
    "Report only what the judgment itself states. Never infer, never generalise from the case name, and never state a monetary figure — money is extracted separately.",
    "Every field you fill must be supported by a verbatim sentence copied exactly from the judgment text, character for character.",
    "If the judgment does not state something, leave that field empty rather than guessing.",
    "Write for a partner who is not a lawyer: plain English, no Latin, no citations.",
  ].join(" ");
}

function userPrompt(subject: string, text: string): string {
  // Judgments run long; the operative facts are in the opening recital and the
  // closing disposition, so both ends are kept and the middle is dropped rather
  // than truncating to the first N characters and losing the outcome entirely.
  const MAX = 24_000;
  const body =
    text.length <= MAX
      ? text
      : `${text.slice(0, MAX * 0.6)}\n\n[…]\n\n${text.slice(-Math.floor(MAX * 0.4))}`;
  return [
    `Subject of the pre-screen: ${subject}`,
    "",
    "Read the judgment below and report what the dispute is about, what was sought, how it ended, and what it means for the subject.",
    "",
    body,
  ].join("\n");
}

async function askBedrock(subject: string, text: string): Promise<RawSubstance> {
  const { data } = await callBedrockStructured<RawSubstance>({
    system: systemPrompt(),
    user: userPrompt(subject, text),
    toolName: "report_judgment",
    toolDescription: "Report what a court judgment states about the dispute.",
    schema: SCHEMA as unknown as Record<string, unknown>,
    maxTokens: 1200,
  });
  return data;
}

async function askOpenAI(subject: string, text: string): Promise<RawSubstance> {
  const client = new OpenAI({ apiKey: env.openaiApiKey, timeout: 40_000, maxRetries: 1 });
  const res = await client.chat.completions.create({
    model: env.openaiModel,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: `${systemPrompt()} Reply with JSON matching: ${JSON.stringify(SCHEMA)}` },
      { role: "user", content: userPrompt(subject, text) },
    ],
  });
  return JSON.parse(res.choices[0]?.message?.content ?? "{}") as RawSubstance;
}

/**
 * Read one judgment for its substance.
 *
 * Amounts come from the text by regex whatever happens, so a judgment still
 * yields its numbers when no model is configured or every provider fails.
 */
export async function readJudgmentSubstance(
  subject: string,
  text: string,
  onNote?: (note: string) => void,
): Promise<JudgmentSubstance> {
  const amounts = extractAmounts(text);
  const base: JudgmentSubstance = { amounts, evidence: [] };
  if (!text.trim()) return base;

  for (const provider of llmProviderChain()) {
    try {
      const raw: RawSubstance = provider === "bedrock" ? await askBedrock(subject, text) : await askOpenAI(subject, text);
      return validate(raw, text, amounts);
    } catch (err) {
      onNote?.(`Judgment read via ${provider} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return base;
}

/**
 * Keep only the fields the document actually supports.
 *
 * The quote is the contract. A model that paraphrases its own evidence has not
 * shown the sentence exists, and a governance brief cannot carry a claim whose
 * source cannot be pointed at — so an unsupported field is dropped in silence
 * and the row simply shows less.
 */
export function validate(raw: RawSubstance, text: string, amounts: string[]): JudgmentSubstance {
  const evidence: string[] = [];
  const keep = (value: string | undefined, quote: string | undefined): string | undefined => {
    if (!value?.trim() || !quote?.trim()) return undefined;
    if (!containsQuote(text, quote)) return undefined;
    const line = quote.replace(/\s+/g, " ").trim();
    if (!evidence.includes(line)) evidence.push(line);
    return value.trim();
  };

  const dispute = keep(raw.dispute, raw.disputeQuote);
  const reliefSought = keep(raw.reliefSought, raw.reliefQuote);
  const outcome = keep(raw.outcome, raw.outcomeQuote);

  return {
    dispute,
    reliefSought,
    outcome,
    // `stake` is the model's read of consequence rather than a fact in the
    // document, so it only stands when the dispute itself was supported.
    stake: dispute && raw.stake?.trim() ? raw.stake.trim() : undefined,
    amounts,
    evidence,
  };
}

export type { LlmProvider };
