import OpenAI from "openai";
import type { Subject } from "./types";
import { env, hasOpenAI } from "./collectors/env";
import type { Article } from "./collectors/reader";

// ── Reading a profile, not a headline ───────────────────────────────────────
// The registry says who a DIN belongs to and the news says what they have been
// accused of; neither says who the person actually is. A partner walking into a
// meeting wants the same page the subject's Forbes or Wikipedia entry carries —
// the role they hold, the business behind it, the net worth and ranking where a
// source has published one, and the handful of career facts that place them.
//
// This module reads that page and reduces it to structured facts, the same way
// insights.ts reduces a news article to a governance finding. The two share a
// principle that is the whole reason either exists: use ONLY the page in front
// of you, never what the model happens to know, and if the page is about a
// different person of the same name, say so and keep nothing.

/** A structured profile read out of one public page. Every field is optional —
 *  a page carries what it carries, and a missing value is omitted, never
 *  guessed. `highlights` are concise, source-supported statements of fact. */
export interface ProfileFacts {
  /** False when the page is plainly about a different person/company of the
   *  same name — the most common way a profile ends up in the wrong file. */
  concernsSubject: boolean;
  /** Current role / title, e.g. "Chairman & Managing Director". */
  role?: string;
  /** The organisation the role is at, e.g. "Max Healthcare Institute". */
  employer?: string;
  /** One plain line placing the subject — who they are, in a sentence. */
  headline?: string;
  /** A short paragraph of background, in the page's own terms. */
  bio?: string;
  /** Net worth exactly as the source states it, e.g. "$2.6B". */
  netWorth?: string;
  /** A wealth / power ranking as stated, e.g. "#1563 in the world (Forbes)". */
  worldRank?: string;
  nationality?: string;
  /** Year of birth as a string, e.g. "1972". */
  bornYear?: string;
  /** Education, e.g. "MBA, London Business School". */
  education?: string;
  /** Company subjects: year founded. */
  foundedYear?: string;
  /** Company subjects: revenue as stated. */
  revenue?: string;
  /** Company subjects: employee count as stated. */
  employees?: string;
  /** Headquarters / base of operations. */
  headquarters?: string;
  /** 3–8 concise, source-supported facts about career and background. */
  highlights: string[];
  /** The page these facts were read from. */
  url: string;
  title?: string;
}

/** The instruction handed to the reader, so a batched read returns the
 *  biographical passages this profile needs rather than a generic summary. */
export function profileReaderTask(subject: Subject): string {
  const companies = (subject.anchors ?? []).slice(0, 6).join(", ");
  const isCompany = subject.type !== "director";
  return [
    `Extract the passages of this page that describe ${subject.company}` +
      (subject.din ? ` (DIN ${subject.din})` : "") +
      (companies ? ` or their association with: ${companies}` : "") +
      ".",
    isCompany
      ? "Keep: what the company does, when it was founded, its revenue, employee count, headquarters, leadership, and notable milestones."
      : "Keep: their current role and organisation, net worth and any wealth or power ranking, nationality, year of birth, education, career history and notable milestones.",
    "Return the relevant text verbatim; do not summarise away the numbers, dates or names.",
  ].join(" ");
}

/**
 * Reduce read profile pages to structured facts.
 *
 * One call per page, deliberately — the same reason insights.ts does: a combined
 * call lets one page's facts drift onto another's citation, and a profile whose
 * net worth is cited to the wrong source is exactly the kind of confident error
 * this pipeline exists not to make. Processed a few at a time so a rate limit
 * costs one page, not the batch.
 */
export async function extractProfile(
  subject: Subject,
  articles: Article[],
  emit?: (text: string, meta?: { url?: string; level?: "step" | "skip" | "warn" }) => void,
): Promise<ProfileFacts[]> {
  if (!hasOpenAI() || articles.length === 0) return [];

  const client = new OpenAI({ apiKey: env.openaiApiKey, timeout: 40_000, maxRetries: 1 });
  const out: ProfileFacts[] = [];
  const CONCURRENCY = 3;

  for (let i = 0; i < articles.length; i += CONCURRENCY) {
    const chunk = articles.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      chunk.map(async (article) => {
        try {
          return await readOne(client, subject, article, emit);
        } catch (err) {
          emit?.(`Could not read the profile at ${article.title ?? article.url} — ${err instanceof Error ? err.message : String(err)}`, {
            level: "warn",
          });
          return null;
        }
      }),
    );
    for (const r of results) if (r) out.push(r);
  }

  return out;
}

async function readOne(
  client: OpenAI,
  subject: Subject,
  article: Article,
  emit?: (text: string, meta?: { url?: string; level?: "step" | "skip" | "warn" }) => void,
): Promise<ProfileFacts | null> {
  const companies = (subject.anchors ?? []).slice(0, 6);
  const isCompany = subject.type !== "director";

  const system = [
    "You build a factual profile of a due-diligence subject from a single public page (e.g. a Forbes profile, a Wikipedia article, a company page).",
    "Rules:",
    "1. Use ONLY this page's text. Never add anything you know about the subject from elsewhere — an unsupported net worth or title is worse than a blank field.",
    "2. If the page is about a DIFFERENT person or company that merely shares the subject's name, set concernsSubject to false and return empty fields. Sharing a name is the most common error here.",
    "3. Fill a field only when the page states it. Leave it null otherwise — do not estimate, round, or infer.",
    "4. `netWorth`, `worldRank`, `revenue`, `employees` must be copied as the page states them (keep the units and the currency).",
    "5. `highlights` are 3–8 short, self-contained facts drawn from the page: career moves, company milestones, education, roles held. One fact each, no opinion, no repetition of the headline.",
    "6. Keep everything concise. This is a reference card, not an essay.",
  ].join("\n");

  const user = [
    `SUBJECT: ${subject.company}${subject.din ? ` (DIN ${subject.din})` : ""} — ${isCompany ? "a company" : "an individual / director"}`,
    companies.length > 0 ? `KNOWN ASSOCIATIONS: ${companies.join(", ")}` : "",
    "",
    `PAGE TITLE: ${article.title ?? "(untitled)"}`,
    `PAGE URL: ${article.url}`,
    "",
    "PAGE TEXT:",
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
    response_format: { type: "json_schema", json_schema: { name: "subject_profile", strict: true, schema: schema() } },
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) return null;
  const parsed = JSON.parse(raw) as ModelResponse;

  if (!parsed.concernsSubject) {
    emit?.(`Read the profile at ${article.title ?? article.url} — it is about someone else of the same name, excluded`, { level: "skip" });
    return null;
  }

  const highlights = (parsed.highlights ?? [])
    .map((h) => String(h ?? "").trim())
    .filter((h) => h.length > 0)
    .slice(0, 8);

  const facts: ProfileFacts = {
    concernsSubject: true,
    role: str(parsed.role),
    employer: str(parsed.employer),
    headline: str(parsed.headline),
    bio: str(parsed.bio),
    netWorth: str(parsed.netWorth),
    worldRank: str(parsed.worldRank),
    nationality: str(parsed.nationality),
    bornYear: str(parsed.bornYear),
    education: str(parsed.education),
    foundedYear: str(parsed.foundedYear),
    revenue: str(parsed.revenue),
    employees: str(parsed.employees),
    headquarters: str(parsed.headquarters),
    highlights,
    url: article.url,
    title: article.title,
  };

  // A page that yielded nothing usable is not a profile — drop it so the
  // collector's count reflects pages that actually said something.
  const hasAny =
    facts.role || facts.headline || facts.bio || facts.netWorth || facts.worldRank || facts.revenue || highlights.length > 0;
  if (!hasAny) return null;

  emit?.(`Read the profile at ${article.title ?? article.url} — ${highlights.length} background fact(s)`);
  return facts;
}

function str(v: unknown): string | undefined {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length > 0 ? s : undefined;
}

interface ModelResponse {
  concernsSubject: boolean;
  role?: string | null;
  employer?: string | null;
  headline?: string | null;
  bio?: string | null;
  netWorth?: string | null;
  worldRank?: string | null;
  nationality?: string | null;
  bornYear?: string | null;
  education?: string | null;
  foundedYear?: string | null;
  revenue?: string | null;
  employees?: string | null;
  headquarters?: string | null;
  highlights?: Array<string | null>;
}

function schema() {
  const nullableString = { type: ["string", "null"] };
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "concernsSubject",
      "role",
      "employer",
      "headline",
      "bio",
      "netWorth",
      "worldRank",
      "nationality",
      "bornYear",
      "education",
      "foundedYear",
      "revenue",
      "employees",
      "headquarters",
      "highlights",
    ],
    properties: {
      concernsSubject: { type: "boolean" },
      role: nullableString,
      employer: nullableString,
      headline: nullableString,
      bio: nullableString,
      netWorth: nullableString,
      worldRank: nullableString,
      nationality: nullableString,
      bornYear: nullableString,
      education: nullableString,
      foundedYear: nullableString,
      revenue: nullableString,
      employees: nullableString,
      headquarters: nullableString,
      highlights: { type: "array", items: { type: "string" } },
    },
  };
}
