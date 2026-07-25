import type { CollectorResult, RawHit } from "../types";
import { env, hasMca } from "./env";
import { fetchWithTimeout, type Collector } from "./types";

// ── MCA collector ──────────────────────────────────────────────────────────
// The Ministry of Corporate Affairs (mca.gov.in) is the official Indian company
// registry — the authoritative source for the DIRECTORS and FINANCIALS of
// UNLISTED companies (listed companies also disclose via exchanges, but unlisted
// ones only surface here). MCA has no free public API and financials are paid
// document access, so this collector runs against a configured data provider
// (MCA_API_TOKEN + MCA_API_URL) and skips honestly when that isn't set.
//
// It captures three things per company:
//   • master data  — CIN, status, incorporation date, class, authorised/paid-up
//   • directors     — name, DIN, designation, appointment date
//   • financials    — latest filed revenue / net-worth / PAT (as filed)
//
// The provider response shape varies, so parsing is defensive: we read a range
// of likely field names and never fabricate a value that isn't present.

export const mcaCollector: Collector = async ({ subject }) => {
  const base: Omit<CollectorResult, "status" | "hits"> = {
    sourceId: "mca",
    sourceName: "MCA (Corporate Affairs)",
    kind: "api",
  };

  const company = subject.company.trim();
  if (!company) {
    return { ...base, status: "skipped", note: "No company to look up.", hits: [] };
  }

  if (!hasMca()) {
    return {
      ...base,
      status: "skipped",
      note: "MCA data provider not configured (set MCA_API_TOKEN / MCA_API_URL).",
      hits: [],
    };
  }

  try {
    const data = await fetchCompany(company);
    if (!data) {
      return { ...base, status: "done", note: `No MCA record found for "${company}".`, hits: [] };
    }

    const hits: RawHit[] = [];
    const url = data.url ?? mcaViewUrl(data.cin);

    // 1. Company master data — one summary hit.
    const master = masterLine(data);
    if (master) {
      hits.push({ title: master, url, entity: company, extra: { category: "master", cin: data.cin } });
    }

    // 2. Directors — one hit each (the core "who runs this company" signal).
    for (const d of data.directors) {
      const bits = [d.name, d.designation, d.din ? `DIN ${d.din}` : "", d.since ? `since ${d.since}` : ""]
        .filter(Boolean)
        .join(" — ");
      if (bits) hits.push({ title: bits, url, entity: company, extra: { category: "director", din: d.din } });
    }

    // 3. Financials — one hit per figure that was actually filed.
    for (const f of data.financials) {
      hits.push({ title: `${f.label}: ${f.value}`, url, entity: company, extra: { category: "financial" } });
    }

    const note = hits.length === 0 ? `MCA record found for "${company}" but no fields parsed.` : undefined;
    return { ...base, status: "done", note, hits };
  } catch (err) {
    return {
      ...base,
      status: "error",
      note: `MCA lookup failed: ${err instanceof Error ? err.message : String(err)}`,
      hits: [],
    };
  }
};

// ── Provider fetch + defensive parsing ─────────────────────────────────────

interface Director {
  name: string;
  din?: string;
  designation?: string;
  since?: string;
}
interface Financial {
  label: string;
  value: string;
}
interface CompanyRecord {
  cin?: string;
  status?: string;
  incorporated?: string;
  companyClass?: string;
  authorisedCapital?: string;
  paidUpCapital?: string;
  registeredOffice?: string;
  url?: string;
  directors: Director[];
  financials: Financial[];
}

async function fetchCompany(company: string): Promise<CompanyRecord | null> {
  const url = `${env.mcaApiUrl}?q=${encodeURIComponent(company)}`;
  const res = await fetchWithTimeout(url, {
    timeoutMs: 15000,
    headers: {
      accept: "application/json",
      Authorization: `Bearer ${env.mcaApiToken}`,
    },
  });
  if (!res.ok) throw new Error(`provider ${res.status}`);
  const data = await res.json();
  return parseRecord(data);
}

function parseRecord(data: unknown): CompanyRecord | null {
  const root = unwrap(data);
  if (!root) return null;

  return {
    cin: str(root.cin ?? root.CIN ?? root.companyId),
    status: str(root.status ?? root.companyStatus ?? root.efilingStatus),
    incorporated: str(root.incorporationDate ?? root.dateOfIncorporation ?? root.incorporated),
    companyClass: str(root.companyClass ?? root.class ?? root.category),
    authorisedCapital: str(root.authorisedCapital ?? root.authorizedCapital ?? root.authCapital),
    paidUpCapital: str(root.paidUpCapital ?? root.paidupCapital ?? root.paidCapital),
    registeredOffice: str(root.registeredOffice ?? root.registeredAddress ?? root.address),
    url: str(root.url ?? root.link),
    directors: parseDirectors(root.directors ?? root.signatories ?? root.dins),
    financials: parseFinancials(root.financials ?? root.financialSummary ?? root.finance),
  };
}

// A provider may wrap the record in { data }, { company }, { result }, or return
// an array of matches (we take the first).
function unwrap(data: unknown): Record<string, unknown> | null {
  if (Array.isArray(data)) return data.length ? unwrap(data[0]) : null;
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    for (const key of ["data", "company", "result", "record"]) {
      if (o[key] && typeof o[key] === "object") return unwrap(o[key]);
    }
    return o;
  }
  return null;
}

function parseDirectors(raw: unknown): Director[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r) => {
      const o = (r ?? {}) as Record<string, unknown>;
      return {
        name: str(o.name ?? o.directorName ?? o.fullName) ?? "",
        din: str(o.din ?? o.DIN ?? o.dinNumber),
        designation: str(o.designation ?? o.role ?? o.position),
        since: str(o.appointmentDate ?? o.since ?? o.dateOfAppointment),
      };
    })
    .filter((d) => d.name.length > 0);
}

function parseFinancials(raw: unknown): Financial[] {
  const out: Financial[] = [];
  if (!raw || typeof raw !== "object") return out;
  // Accept either a labelled object or an array of {label,value} rows.
  if (Array.isArray(raw)) {
    for (const r of raw) {
      const o = (r ?? {}) as Record<string, unknown>;
      const label = str(o.label ?? o.name ?? o.metric);
      const value = str(o.value ?? o.amount ?? o.figure);
      if (label && value) out.push({ label, value });
    }
    return out;
  }
  const o = raw as Record<string, unknown>;
  const known: Array<[string, string]> = [
    ["Revenue", "revenue"],
    ["Net worth", "netWorth"],
    ["Profit after tax", "pat"],
    ["Total assets", "totalAssets"],
    ["Total liabilities", "totalLiabilities"],
  ];
  for (const [label, key] of known) {
    const v = str(o[key] ?? o[key.toLowerCase()]);
    if (v) out.push({ label, value: v });
  }
  return out;
}

function masterLine(d: CompanyRecord): string | undefined {
  const parts = [
    d.cin ? `CIN ${d.cin}` : "",
    d.status ? `status: ${d.status}` : "",
    d.incorporated ? `incorporated ${d.incorporated}` : "",
    d.companyClass ? `class: ${d.companyClass}` : "",
    d.authorisedCapital ? `authorised capital ${d.authorisedCapital}` : "",
    d.paidUpCapital ? `paid-up ${d.paidUpCapital}` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : undefined;
}

function mcaViewUrl(cin?: string): string | undefined {
  return cin ? `https://www.mca.gov.in/mcafoportal/viewCompanyMasterData.do?cin=${encodeURIComponent(cin)}` : undefined;
}

/** Coerce to a trimmed non-empty string, or undefined. */
function str(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}
