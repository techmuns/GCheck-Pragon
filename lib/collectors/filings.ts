import type { CollectorResult, RawHit } from "../types";
import { env, hasFilings } from "./env";
import { fetchWithTimeout, stripHtml, type Collector } from "./types";

// ── Filings & Disclosures collector ─────────────────────────────────────────
// Exchange filings, annual reports, earnings and concalls from
// BSE/NSE/DRHP/screener.in (India), via the Muns combined-filings endpoint.
// These regulatory disclosures are where adverse corporate events surface, so
// they belong in a governance pre-screen.
//
// Requires a stock TICKER on the subject (the API keys off ticker, not name).
// Without a ticker it skips honestly; without a token it skips honestly. Item
// field names aren't fully specified, so parsing is defensive.

// Filing types whose title/description warrants a closer look.
const CONCERN_TERMS = [
  "resignation", "resign", "default", "fraud", "investigation", "sebi",
  "penalty", "penalise", "penalize", "qualified opinion", "auditor",
  "insolvency", "nclt", "ibc", "delay", "non-compliance", "show cause",
  "forensic", "restated", "material",
];

export const filingsCollector: Collector = async ({ subject }) => {
  const base: Omit<CollectorResult, "status" | "hits"> = {
    sourceId: "filings",
    sourceName: "Filings & Disclosures",
    kind: "api",
  };

  const ticker = subject.ticker?.trim();
  if (!ticker) {
    return {
      ...base,
      status: "skipped",
      note: "No stock ticker provided — add one (e.g. RELIANCE) to fetch exchange filings.",
      hits: [],
    };
  }

  if (!hasFilings()) {
    return {
      ...base,
      status: "skipped",
      note: "Filings source not configured (set FILINGS_TOKEN or MUNSHOT_TOKEN).",
      hits: [],
    };
  }

  try {
    const items = await fetchFilings(ticker);
    const hits: RawHit[] = items.map((it): RawHit => {
      const haystack = `${it.title} ${it.description ?? ""}`.toLowerCase();
      const matched = CONCERN_TERMS.filter((t) => haystack.includes(t));
      return {
        title: it.title,
        url: it.url,
        snippet: it.description,
        entity: subject.company,
        date: it.date,
        matchedKeywords: matched.length ? matched : undefined,
        extra: { category: "filing", form: it.form },
      };
    });

    const note = hits.length === 0 ? `No filings found for ticker "${ticker}".` : undefined;
    return { ...base, status: "done", note, hits };
  } catch (err) {
    return {
      ...base,
      status: "error",
      note: `Filings lookup failed: ${err instanceof Error ? err.message : String(err)}`,
      hits: [],
    };
  }
};

interface FilingItem {
  title: string;
  description?: string;
  url?: string;
  date?: string;
  form?: string;
}

async function fetchFilings(ticker: string): Promise<FilingItem[]> {
  const res = await fetchWithTimeout(env.filingsUrl, {
    method: "POST",
    timeoutMs: 20000,
    headers: {
      "Content-Type": "application/json",
      accept: "application/json",
      Authorization: `Bearer ${env.filingsToken}`,
    },
    body: JSON.stringify({
      ticker,
      country: env.filingsCountry,
      form: ["all"],
    }),
  });
  if (!res.ok) throw new Error(`filings ${res.status}`);
  const data = await res.json();
  return parseFilings(data);
}

// The endpoint returns an array (or a wrapped array). Item shapes aren't fully
// documented, so read a range of likely field names for each attribute.
function parseFilings(data: unknown): FilingItem[] {
  const rows = extractRows(data);
  return rows
    .map((r): FilingItem => {
      const o = (r ?? {}) as Record<string, unknown>;
      const title = str(o.title ?? o.subject ?? o.headline ?? o.name ?? o.type ?? o.category) ?? "";
      const description = str(o.description ?? o.details ?? o.summary ?? o.text ?? o.remarks);
      const url = str(o.url ?? o.link ?? o.attachment ?? o.pdf ?? o.fileUrl ?? o.attachmentUrl);
      const date = str(o.date ?? o.filingDate ?? o.announcementDate ?? o.submittedAt ?? o.publishedAt ?? o.dateTime);
      const form = str(o.form ?? o.formType ?? o.category ?? o.type);
      return {
        title: title || description || "Filing",
        description: description && description !== title ? stripHtml(description) : undefined,
        url,
        date,
        form,
      };
    })
    .filter((f) => f.title.length > 0);
}

function extractRows(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    for (const key of ["data", "results", "filings", "items", "announcements"]) {
      if (Array.isArray(o[key])) return o[key] as unknown[];
    }
    if (o.data && typeof o.data === "object") return extractRows(o.data);
  }
  return [];
}

function str(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}
