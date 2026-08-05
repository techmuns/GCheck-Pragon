import OpenAI from "openai";
import type { Subject } from "./types";
import { env, hasOpenAI } from "./collectors/env";
import type { Article } from "./collectors/reader";

// ── Reading an article, not its headline ────────────────────────────────────
// The brief used to be written from titles alone. That is enough to know a
// matter exists and never enough to know what it means: the single fact that
// decides how a partner should read "Saarthi raises serious allegations
// against Classplus" is that the subject BROUGHT the complaint. A pipeline
// that cannot tell a complainant from an accused will, sooner or later, put
// someone's own lawsuit in their file as an allegation against them.
//
// So each article is read separately and reduced to structured facts. One call
// per article, deliberately: a combined call blows the context and lets one
// article's facts drift onto another's citation, and the citation is the only
// thing making any of this checkable.

/** How the subject appears in the matter. The field this module exists for. */
export type SubjectRole =
  | "complainant"
  | "petitioner"
  | "accused"
  | "defendant"
  | "respondent"
  | "bystander"
  | "not_mentioned"
  | "unclear";

export type Polarity = "adverse" | "neutral" | "positive";

export interface Insight {
  /** One plain sentence: what happened. */
  what: string;
  role: SubjectRole;
  /** The verbatim sentence that establishes the role. Validated, not trusted. */
  roleEvidence?: string;
  about: "person" | "company" | "both";
  entity?: string;
  severity: "red" | "amber" | "info";
  polarity: Polarity;
  date?: string;
  amount?: string;
  authority?: string;
  status?: string;
  /** A short verbatim quote, for the concern card's evidence line. */
  quote?: string;
  /** The article it came from. */
  url: string;
  title?: string;
}

const ROLES: SubjectRole[] = [
  "complainant",
  "petitioner",
  "accused",
  "defendant",
  "respondent",
  "bystander",
  "not_mentioned",
  "unclear",
];
const SEVERITIES = ["red", "amber", "info"] as const;
const POLARITIES: Polarity[] = ["adverse", "neutral", "positive"];

/** The instruction handed to the reader, so a batched read still returns the
 *  passages this subject's brief needs rather than a generic summary. */
export function readerTask(subject: Subject): string {
  const companies = (subject.anchors ?? []).slice(0, 6).join(", ");
  return [
    `Extract the passages of this article that concern ${subject.company}` +
      (subject.din ? ` (DIN ${subject.din})` : "") +
      (companies ? ` or any of these companies: ${companies}` : "") +
      ".",
    "For each, keep: what happened, who alleged or filed what against whom, the court or authority involved, dates, amounts, and the current status.",
    "Preserve who is the complainant and who is the accused.",
    "Also keep, verbatim, any sentence stating a family or related-party tie — X is the wife/brother/sister/in-law of Y, X founded or controls Z, funds moved between A and B — these links are how adverse matters at one company reach another.",
    "Return the relevant text verbatim; do not summarise away the names.",
  ].join(" ");
}

/**
 * Reduce read articles to structured findings.
 *
 * Articles are processed a few at a time rather than all at once: the reads
 * ahead of this already took minutes, and a burst of concurrent completions
 * against a rate limit would cost the whole batch instead of one article.
 */
export async function extractInsights(
  subject: Subject,
  articles: Article[],
  emit?: (text: string, meta?: { url?: string; level?: "step" | "skip" | "warn" }) => void,
): Promise<Insight[]> {
  if (!hasOpenAI() || articles.length === 0) return [];

  const client = new OpenAI({ apiKey: env.openaiApiKey, timeout: 40_000, maxRetries: 1 });
  const out: Insight[] = [];
  const CONCURRENCY = 3;

  for (let i = 0; i < articles.length; i += CONCURRENCY) {
    const chunk = articles.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      chunk.map(async (article) => {
        try {
          return await readOne(client, subject, article, emit);
        } catch (err) {
          emit?.(`Could not read ${article.title ?? article.url} — ${err instanceof Error ? err.message : String(err)}`, {
            level: "warn",
          });
          return [];
        }
      }),
    );
    out.push(...results.flat());
  }

  return out;
}

async function readOne(
  client: OpenAI,
  subject: Subject,
  article: Article,
  emit?: (text: string, meta?: { url?: string; level?: "step" | "skip" | "warn" }) => void,
): Promise<Insight[]> {
  const companies = (subject.anchors ?? []).slice(0, 6);

  const system = [
    "You extract governance facts from a single news article for a pre-meeting due-diligence brief.",
    "Rules:",
    "1. Use ONLY the article text. Never infer, never draw on anything you know about these people or companies from elsewhere.",
    "2. `role` is the most important field. If the subject FILED the suit, complaint or FIR, they are the complainant or petitioner — never write that as something done to them. If they are the one accused, say so. If the article does not make it explicit, answer 'unclear' and quote the sentence you judged from.",
    "3. `roleEvidence` must be a sentence copied VERBATIM from the article. Do not paraphrase it.",
    "4. If the article is about a different person who shares the subject's name, set concernsSubject to false. Sharing a name is the most common way a brief gets this wrong.",
    "5. `severity` is risk to the reader's decision, not drama. Someone who brought a fraud suit is 'amber' — they are in litigation, which is worth knowing — never 'red' as though they were accused of it.",
    "6. `polarity` is 'positive' for awards, funding, recognition and appointments. These are not concerns and are reported separately.",
    "7. One insight per distinct matter. Do not restate the headline as a finding.",
    "8. If the article carries no governance-relevant fact about the subject or their companies, return an empty insights list.",
  ].join("\n");

  const user = [
    `SUBJECT: ${subject.company}${subject.din ? ` (DIN ${subject.din})` : ""}`,
    companies.length > 0 ? `SUBJECT'S COMPANIES: ${companies.join(", ")}` : "",
    "",
    `ARTICLE TITLE: ${article.title ?? "(untitled)"}`,
    `ARTICLE URL: ${article.url}`,
    "",
    "ARTICLE TEXT:",
    article.text,
  ]
    .filter(Boolean)
    .join("\n");

  const completion = await client.chat.completions.create({
    model: env.openaiModel,
    temperature: 0,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: { type: "json_schema", json_schema: { name: "article_insights", strict: true, schema: schema() } },
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) return [];
  const parsed = JSON.parse(raw) as ModelResponse;

  if (!parsed.concernsSubject) {
    emit?.(`Read ${article.title ?? article.url} — it concerns someone else of the same name, excluded`, { level: "skip" });
    return [];
  }

  const kept: Insight[] = [];
  for (const m of parsed.insights ?? []) {
    const what = String(m.what ?? "").trim();
    if (!what) continue;

    // The role is the field carrying the most weight and the one a model is
    // most tempted to smooth over, so the sentence it claims to have judged
    // from must actually be in the article. A quote that is not there means
    // the role was invented, and an invented role is worse than no finding.
    const evidence = String(m.roleEvidence ?? "").trim();
    const definite = m.role !== "unclear" && m.role !== "not_mentioned";
    if (definite && evidence && !contains(article.text, evidence)) {
      emit?.(`Dropped a finding from ${article.title ?? article.url} — its role quote is not in the article`, {
        level: "warn",
      });
      continue;
    }

    kept.push({
      what,
      role: ROLES.includes(m.role as SubjectRole) ? (m.role as SubjectRole) : "unclear",
      roleEvidence: evidence || undefined,
      about: m.about === "person" || m.about === "company" || m.about === "both" ? m.about : "both",
      entity: str(m.entity),
      severity: (SEVERITIES as readonly string[]).includes(m.severity ?? "") ? (m.severity as Insight["severity"]) : "info",
      polarity: POLARITIES.includes(m.polarity as Polarity) ? (m.polarity as Polarity) : "neutral",
      date: str(m.date),
      amount: str(m.amount),
      authority: str(m.authority),
      status: str(m.status),
      quote: str(m.quote),
      url: article.url,
      title: article.title,
    });
  }

  if (kept.length > 0) emit?.(`Read ${article.title ?? article.url} — ${kept.length} finding(s)`);
  return kept;
}

/** Whitespace-insensitive containment, so a quote that differs only in line
 *  wrapping still counts as verbatim. */
function contains(haystack: string, needle: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[\s ]+/g, " ").replace(/[“”"’']/g, "'").trim();
  return norm(haystack).includes(norm(needle));
}

function str(v: unknown): string | undefined {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length > 0 ? s : undefined;
}

interface ModelInsight {
  what?: string;
  role?: string;
  roleEvidence?: string | null;
  about?: string;
  entity?: string | null;
  severity?: string;
  polarity?: string;
  date?: string | null;
  amount?: string | null;
  authority?: string | null;
  status?: string | null;
  quote?: string | null;
}

interface ModelResponse {
  concernsSubject: boolean;
  insights?: ModelInsight[];
}

function schema() {
  const nullableString = { type: ["string", "null"] };
  return {
    type: "object",
    additionalProperties: false,
    required: ["concernsSubject", "insights"],
    properties: {
      concernsSubject: { type: "boolean" },
      insights: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "what",
            "role",
            "roleEvidence",
            "about",
            "entity",
            "severity",
            "polarity",
            "date",
            "amount",
            "authority",
            "status",
            "quote",
          ],
          properties: {
            what: { type: "string" },
            role: { type: "string", enum: ROLES },
            roleEvidence: nullableString,
            about: { type: "string", enum: ["person", "company", "both"] },
            entity: nullableString,
            severity: { type: "string", enum: SEVERITIES },
            polarity: { type: "string", enum: POLARITIES },
            date: nullableString,
            amount: nullableString,
            authority: nullableString,
            status: nullableString,
            quote: nullableString,
          },
        },
      },
    },
  };
}
