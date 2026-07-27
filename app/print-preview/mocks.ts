import type { Citation, CollectorResult, RenderedSection, Run, SourceProgress } from "@/lib/types";

// ── Synthetic runs for the print-brief QA harness ─────────────────────────────
// Three densities exercise the fixed one-page layout end to end:
//   short   — cleared verdict, sparse data (sections collapse, no blank page)
//   average — moderate/amber, a handful of items in every section
//   max     — high risk, every section over its cap (drives "+N more" everywhere)
// These never ship to users; the /print-preview route 404s outside development.

export type Size = "short" | "average" | "max" | "director";

const CREATED = "2026-07-27T14:32:00.000Z";

export function mockRun(size: Size): Run {
  switch (size) {
    case "short":
      return shortRun();
    case "max":
      return maxRun();
    case "director":
      return directorRun();
    default:
      return averageRun();
  }
}

// ── director mode: a person, not a company ────────────────────────────────────

function directorRun(): Run {
  const progress: SourceProgress[] = [
    { sourceId: "google", name: "Google & News", kind: "api", status: "done", hits: 4 },
    { sourceId: "indiankanoon", name: "Court Cases", kind: "api", status: "done", hits: 3 },
    { sourceId: "registry", name: "Company Registry (Tofler)", kind: "api", status: "skipped", note: "Director search — no company board to look up." },
    { sourceId: "wikidata", name: "Wikidata (Directors)", kind: "api", status: "done", hits: 2 },
    { sourceId: "cibil", name: "Loan Defaults", kind: "browser", status: "locked", note: "Available on the upgraded plan." },
  ];

  const collected: CollectorResult[] = [
    {
      sourceId: "wikidata",
      sourceName: "Wikidata (Directors)",
      kind: "api",
      status: "done",
      hits: [
        { title: "Chairperson of Vertex Holdings", url: "https://www.wikidata.org/wiki/Q1", entity: "Vijay Malhotra", extra: { category: "leadership", role: "Chairperson" } },
        { title: "Director of Meridian Capital Advisors", url: "https://www.wikidata.org/wiki/Q2", entity: "Vijay Malhotra", extra: { category: "leadership", role: "Director" } },
      ],
    },
    {
      sourceId: "indiankanoon",
      sourceName: "Indian Kanoon",
      kind: "api",
      status: "done",
      hits: [
        { title: "SEBI vs Vijay Malhotra on 5 May, 2021", url: "https://indiankanoon.org/doc/301/", entity: "Vijay Malhotra", extra: { court: "Securities Appellate Tribunal" } },
        { title: "Vijay Malhotra vs Enforcement Directorate on 18 October, 2022", url: "https://indiankanoon.org/doc/302/", entity: "Vijay Malhotra", extra: { court: "Delhi High Court" } },
        { title: "Registrar of Companies vs Vijay Malhotra on 2 February, 2020", url: "https://indiankanoon.org/doc/303/", entity: "Vijay Malhotra", extra: { court: "NCLT Delhi" } },
      ],
    },
    {
      sourceId: "google",
      sourceName: "Google / News",
      kind: "api",
      status: "done",
      hits: [
        { title: "SEBI bars Vijay Malhotra from markets for two years", url: "https://news.example.com/vm1", entity: "Vijay Malhotra", matchedKeywords: ["sebi"] },
        { title: "Vijay Malhotra steps down from Vertex board", url: "https://news.example.com/vm2", entity: "Vijay Malhotra" },
        { title: "ED questions Vijay Malhotra in fund-diversion probe", url: "https://news.example.com/vm3", entity: "Vijay Malhotra", matchedKeywords: ["investigation"] },
      ],
    },
  ];

  const citations: Citation[] = [
    { ref: 1, sourceName: "Google / News", label: "SEBI bars Vijay Malhotra from markets for two years", url: "https://news.example.com/vm1" },
    { ref: 2, sourceName: "Indian Kanoon", label: "SEBI vs Vijay Malhotra", url: "https://indiankanoon.org/doc/301/" },
    { ref: 3, sourceName: "Indian Kanoon", label: "Vijay Malhotra vs Enforcement Directorate", url: "https://indiankanoon.org/doc/302/" },
    { ref: 4, sourceName: "Wikidata (Directors)", label: "Chairperson of Vertex Holdings", url: "https://www.wikidata.org/wiki/Q1" },
  ];

  const sections: RenderedSection[] = [
    {
      id: "red-flags",
      title: "Key Concerns",
      findings: [
        { severity: "red", text: "SEBI has barred the individual from the securities market for two years.", sourceRef: 1 },
        { severity: "amber", text: "Named in an Enforcement Directorate fund-diversion probe.", sourceRef: 3 },
      ],
    },
  ];

  return {
    id: "mock_director",
    subject: { type: "director", company: "Vijay Malhotra", promoters: [] },
    status: "complete",
    createdAt: CREATED,
    progress,
    collected,
    brief: {
      verdict: "red",
      headline: "Vijay Malhotra carries a live SEBI market ban and an active ED probe — treat any association as high-risk pending clarification.",
      sections,
      citations,
      synthesizedBy: "ai",
    },
  };
}

// ── short: cleared, sparse ────────────────────────────────────────────────────

function shortRun(): Run {
  const progress: SourceProgress[] = [
    { sourceId: "google", name: "Google & News", kind: "api", status: "done", hits: 1 },
    { sourceId: "indiankanoon", name: "Court Cases", kind: "api", status: "done", hits: 0 },
    { sourceId: "registry", name: "Company Registry (Tofler)", kind: "api", status: "done", hits: 2 },
    { sourceId: "wikidata", name: "Wikidata (Directors)", kind: "api", status: "done", hits: 0 },
    { sourceId: "cibil", name: "Loan Defaults", kind: "browser", status: "locked", note: "Available on the upgraded plan." },
  ];

  const collected: CollectorResult[] = [
    {
      sourceId: "registry",
      sourceName: "Company Registry (Tofler)",
      kind: "api",
      status: "done",
      hits: [
        director("Meera Krishnan", "Director", "07711223", "6 years 2 months", "U01100KA2018PTC112233"),
        director("Arvind Rao", "Director", "07711224", "6 years 2 months", "U01100KA2018PTC112233"),
      ],
    },
    { sourceId: "indiankanoon", sourceName: "Indian Kanoon", kind: "api", status: "done", hits: [] },
    {
      sourceId: "google",
      sourceName: "Google / News",
      kind: "api",
      status: "done",
      hits: [{ title: "Green Valley Farms expands organic produce range", url: "https://example.com/gv1", entity: "Green Valley Farms Pvt Ltd" }],
    },
  ];

  const citations: Citation[] = [
    { ref: 1, sourceName: "Company Registry (Tofler)", label: "Green Valley Farms Pvt Ltd", url: "https://tofler.in/x/company/U01100KA2018PTC112233" },
    { ref: 2, sourceName: "Google / News", label: "Green Valley Farms expands organic produce range", url: "https://example.com/gv1" },
  ];

  const sections: RenderedSection[] = [
    { id: "red-flags", title: "Key Concerns", findings: [{ severity: "clear", text: "No red flags surfaced across the sources that completed." }] },
  ];

  return {
    id: "mock_short",
    subject: { type: "company", company: "Green Valley Farms Pvt Ltd", promoters: [] },
    status: "complete",
    createdAt: CREATED,
    progress,
    collected,
    brief: {
      verdict: "clear",
      headline: "No red flags surfaced for Green Valley Farms Pvt Ltd across the sources that ran.",
      sections,
      citations,
      synthesizedBy: "rules",
    },
  };
}

// ── average: amber, moderate ──────────────────────────────────────────────────

function averageRun(): Run {
  const progress: SourceProgress[] = [
    { sourceId: "google", name: "Google & News", kind: "api", status: "done", hits: 5, note: "Keyless fallback engine (blocked from most servers — set MUNSHOT_TOKEN)." },
    { sourceId: "indiankanoon", name: "Court Cases", kind: "api", status: "done", hits: 2 },
    { sourceId: "registry", name: "Company Registry (Tofler)", kind: "api", status: "done", hits: 4 },
    { sourceId: "wikidata", name: "Wikidata (Directors)", kind: "api", status: "done", hits: 0 },
    { sourceId: "filings", name: "Filings & Disclosures", kind: "api", status: "done", hits: 3 },
    { sourceId: "privatecircle", name: "Company & Directors", kind: "browser", status: "locked", note: "Available on the upgraded plan." },
    { sourceId: "cibil", name: "Loan Defaults", kind: "browser", status: "skipped", note: "CIBIL credentials not configured." },
  ];

  const collected: CollectorResult[] = [
    {
      sourceId: "registry",
      sourceName: "Company Registry (Tofler)",
      kind: "api",
      status: "done",
      hits: [
        director("Anil Mehta", "Managing Director", "01234567", "17 years 4 months", "L17110GJ1994PLC021897"),
        director("Priya Mehta", "Whole-time Director", "01234568", "12 years 1 month", "L17110GJ1994PLC021897"),
        director("Ramesh Shah", "Independent Director", "02234569", "4 years 7 months", "L17110GJ1994PLC021897"),
        director("Kavita Nair", "Independent Director", "03234570", "2 years 0 months", "L17110GJ1994PLC021897"),
      ],
    },
    {
      sourceId: "indiankanoon",
      sourceName: "Indian Kanoon",
      kind: "api",
      status: "done",
      hits: [
        { title: "Sterling Textiles Limited vs Commissioner of Income Tax on 8 August, 2022", url: "https://indiankanoon.org/doc/111/", entity: "Sterling Textiles Limited", extra: { court: "Income Tax Appellate Tribunal" } },
        { title: "Workmen of Sterling Textiles Limited vs Management on 3 February, 2019", url: "https://indiankanoon.org/doc/112/", entity: "Sterling Textiles Limited", extra: { court: "Gujarat High Court" } },
      ],
    },
    {
      sourceId: "google",
      sourceName: "Google / News",
      kind: "api",
      status: "done",
      hits: [
        { title: "Sterling Textiles faces labour dispute at Surat unit", url: "https://news.example.com/st1", entity: "Sterling Textiles Limited", matchedKeywords: ["legal"] },
        { title: "Sterling Textiles reports 12% rise in FY25 revenue", url: "https://news.example.com/st2", entity: "Sterling Textiles Limited" },
        { title: "Sterling Textiles in tax tribunal over disputed deductions", url: "https://news.example.com/st3", entity: "Sterling Textiles Limited", matchedKeywords: ["court"] },
        { title: "Sterling Textiles signs export deal with EU buyer", url: "https://news.example.com/st4", entity: "Sterling Textiles Limited" },
        { title: "Sterling Textiles opens new spinning line", url: "https://news.example.com/st5", entity: "Sterling Textiles Limited" },
      ],
    },
    {
      sourceId: "filings",
      sourceName: "Filings & Disclosures",
      kind: "api",
      status: "done",
      hits: [
        { title: "Outcome of Board Meeting — audited results FY25", url: "https://bse.example.com/f1", entity: "Sterling Textiles Limited", date: "2026-05-21", extra: { category: "filing", form: "Financial Results" } },
        { title: "Resignation of Independent Director", url: "https://bse.example.com/f2", entity: "Sterling Textiles Limited", date: "2026-03-11", matchedKeywords: ["resignation"], extra: { category: "filing", form: "Board Changes" } },
        { title: "Intimation of dividend record date", url: "https://bse.example.com/f3", entity: "Sterling Textiles Limited", date: "2026-02-02", extra: { category: "filing", form: "Corporate Action" } },
      ],
    },
  ];

  const citations: Citation[] = [
    { ref: 1, sourceName: "Company Registry (Tofler)", label: "Sterling Textiles Limited", url: "https://tofler.in/x/company/L17110GJ1994PLC021897" },
    { ref: 2, sourceName: "Google / News", label: "Sterling Textiles faces labour dispute at Surat unit", url: "https://news.example.com/st1" },
    { ref: 3, sourceName: "Google / News", label: "Sterling Textiles in tax tribunal over disputed deductions", url: "https://news.example.com/st3" },
    { ref: 4, sourceName: "Indian Kanoon", label: "Sterling Textiles Limited vs Commissioner of Income Tax", url: "https://indiankanoon.org/doc/111/" },
    { ref: 5, sourceName: "Indian Kanoon", label: "Workmen of Sterling Textiles Limited vs Management", url: "https://indiankanoon.org/doc/112/" },
    { ref: 6, sourceName: "Filings & Disclosures", label: "Resignation of Independent Director", url: "https://bse.example.com/f2" },
    { ref: 7, sourceName: "Filings & Disclosures", label: "Outcome of Board Meeting — audited results FY25", url: "https://bse.example.com/f1" },
  ];

  const sections: RenderedSection[] = [
    {
      id: "red-flags",
      title: "Key Concerns",
      findings: [
        { severity: "amber", text: "Sterling Textiles in tax tribunal over disputed deductions.", sourceRef: 3 },
        { severity: "amber", text: "Labour dispute at the Surat unit reported in the press.", sourceRef: 2 },
        { severity: "amber", text: "2 litigation record(s) surfaced on Indian Kanoon.", sourceRef: 4 },
      ],
    },
  ];

  return {
    id: "mock_average",
    subject: { type: "company", company: "Sterling Textiles Limited", promoters: ["Anil Mehta"], ticker: "STRTEX" },
    status: "complete",
    createdAt: CREATED,
    progress,
    collected,
    brief: {
      verdict: "amber",
      headline: "Sterling Textiles Limited: a tax-tribunal matter and a labour dispute warrant review before the meeting; no hard red flags.",
      sections,
      citations,
      synthesizedBy: "ai",
    },
  };
}

// ── max: red, every section over cap ─────────────────────────────────────────

function maxRun(): Run {
  const cin = "U70102MH2009PTC198765";
  const progress: SourceProgress[] = [
    { sourceId: "google", name: "Google & News", kind: "api", status: "done", hits: 8 },
    { sourceId: "indiankanoon", name: "Court Cases", kind: "api", status: "done", hits: 5 },
    { sourceId: "registry", name: "Company Registry (Tofler)", kind: "api", status: "done", hits: 6 },
    { sourceId: "wikidata", name: "Wikidata (Directors)", kind: "api", status: "done", hits: 1 },
    { sourceId: "filings", name: "Filings & Disclosures", kind: "api", status: "error", note: "Filings lookup failed: upstream 502." },
    { sourceId: "privatecircle", name: "Company & Directors", kind: "browser", status: "locked", note: "Available on the upgraded plan." },
    { sourceId: "cibil", name: "Loan Defaults", kind: "browser", status: "done", hits: 2 },
  ];

  const collected: CollectorResult[] = [
    {
      sourceId: "registry",
      sourceName: "Company Registry (Tofler)",
      kind: "api",
      status: "done",
      hits: [
        director("Rajesh Kumar Verma", "Managing Director", "00110234", "23 years 5 months", cin),
        director("Sunita Rajesh Verma", "Whole-time Director", "00110235", "21 years 2 months", cin),
        director("Deepak Chandrasekaran Iyer", "Director", "00110236", "9 years 8 months", cin),
        director("Farida Contractor", "Independent Director", "00110237", "3 years 4 months", cin),
        director("Vikram Singh Rathore", "Director", "00110238", "5 years 0 months", cin),
        director("Neha Agarwal", "Company Secretary", "00110239", "1 year 6 months", cin),
      ],
    },
    {
      sourceId: "wikidata",
      sourceName: "Wikidata (Directors)",
      kind: "api",
      status: "done",
      hits: [{ title: "Rajesh Kumar Verma — Founder", url: "https://www.wikidata.org/wiki/Q999", entity: "Adarsh", extra: { category: "leadership", role: "Founder" } }],
    },
    {
      sourceId: "indiankanoon",
      sourceName: "Indian Kanoon",
      kind: "api",
      status: "done",
      hits: [
        { title: "State Bank of India vs Adarsh Infrastructure & Realty Holdings on 14 March, 2021", url: "https://indiankanoon.org/doc/201/", entity: "Adarsh Infrastructure & Realty Holdings (India) Private Limited", extra: { court: "Debts Recovery Tribunal, Mumbai" } },
        { title: "Serious Fraud Investigation Office vs Rajesh Kumar Verma & Ors on 2 September, 2022", url: "https://indiankanoon.org/doc/202/", entity: "Adarsh Infrastructure & Realty Holdings (India) Private Limited", extra: { court: "Special Court (SFIO), Mumbai" } },
        { title: "Adarsh Infrastructure & Realty Holdings vs Municipal Corporation of Greater Mumbai on 19 July, 2020", url: "https://indiankanoon.org/doc/203/", entity: "Adarsh Infrastructure & Realty Holdings (India) Private Limited", extra: { court: "Bombay High Court" } },
        { title: "Income Tax Officer vs Adarsh Infrastructure & Realty Holdings on 11 January, 2019", url: "https://indiankanoon.org/doc/204/", entity: "Adarsh Infrastructure & Realty Holdings (India) Private Limited", extra: { court: "ITAT Mumbai" } },
        { title: "Homebuyers Association vs Adarsh Infrastructure & Realty Holdings on 6 June, 2023", url: "https://indiankanoon.org/doc/205/", entity: "Adarsh Infrastructure & Realty Holdings (India) Private Limited", extra: { court: "NCDRC" } },
      ],
    },
    {
      sourceId: "cibil",
      sourceName: "CIBIL Suit-Filed",
      kind: "browser",
      status: "done",
      hits: [
        { title: "Adarsh Infrastructure & Realty Holdings — Rs 84,50,00,000 outstanding to consortium", entity: "Adarsh Infrastructure & Realty Holdings (India) Private Limited", extra: { category: "Defaulters > Rs 1 cr" } },
        { title: "Rajesh Kumar Verma (guarantor) — Rs 12,00,00,000", entity: "Rajesh Kumar Verma", extra: { category: "Defaulters > Rs 1 cr" } },
      ],
    },
    {
      sourceId: "google",
      sourceName: "Google / News",
      kind: "api",
      status: "done",
      hits: [
        { title: "SFIO probes Adarsh Infrastructure over alleged diversion of homebuyer funds", url: "https://news.example.com/ad1", entity: "Adarsh Infrastructure & Realty Holdings (India) Private Limited", matchedKeywords: ["fraud", "investigation"] },
        { title: "Banks drag Adarsh Infrastructure to DRT over Rs 800 crore default", url: "https://news.example.com/ad2", entity: "Adarsh Infrastructure & Realty Holdings (India) Private Limited", matchedKeywords: ["default", "defaulter"] },
        { title: "CBI names Adarsh promoter in preliminary enquiry", url: "https://news.example.com/ad3", entity: "Adarsh Infrastructure & Realty Holdings (India) Private Limited", matchedKeywords: ["cbi"] },
        { title: "Homebuyers protest stalled Adarsh Realty project in Navi Mumbai", url: "https://news.example.com/ad4", entity: "Adarsh Infrastructure & Realty Holdings (India) Private Limited" },
        { title: "Adarsh Infrastructure auditor flags going-concern doubt", url: "https://news.example.com/ad5", entity: "Adarsh Infrastructure & Realty Holdings (India) Private Limited", matchedKeywords: ["auditor"] },
        { title: "Adarsh Realty defaults on NCD interest payment", url: "https://news.example.com/ad6", entity: "Adarsh Infrastructure & Realty Holdings (India) Private Limited", matchedKeywords: ["default"] },
        { title: "ED attaches Adarsh Infrastructure assets in money-laundering case", url: "https://news.example.com/ad7", entity: "Adarsh Infrastructure & Realty Holdings (India) Private Limited", matchedKeywords: ["money laundering"] },
        { title: "Adarsh Infrastructure wins arbitration against contractor", url: "https://news.example.com/ad8", entity: "Adarsh Infrastructure & Realty Holdings (India) Private Limited" },
      ],
    },
  ];

  const citations: Citation[] = [
    { ref: 1, sourceName: "Google / News", label: "SFIO probes Adarsh Infrastructure over alleged diversion of homebuyer funds", url: "https://news.example.com/ad1" },
    { ref: 2, sourceName: "Google / News", label: "Banks drag Adarsh Infrastructure to DRT over Rs 800 crore default", url: "https://news.example.com/ad2" },
    { ref: 3, sourceName: "Google / News", label: "CBI names Adarsh promoter in preliminary enquiry", url: "https://news.example.com/ad3" },
    { ref: 4, sourceName: "Google / News", label: "ED attaches Adarsh Infrastructure assets in money-laundering case", url: "https://news.example.com/ad7" },
    { ref: 5, sourceName: "Indian Kanoon", label: "State Bank of India vs Adarsh Infrastructure & Realty Holdings", url: "https://indiankanoon.org/doc/201/" },
    { ref: 6, sourceName: "Indian Kanoon", label: "Serious Fraud Investigation Office vs Rajesh Kumar Verma & Ors", url: "https://indiankanoon.org/doc/202/" },
    { ref: 7, sourceName: "Company Registry (Tofler)", label: "Adarsh Infrastructure & Realty Holdings — CIN U70102MH2009PTC198765", url: `https://tofler.in/x/company/${cin}` },
    { ref: 8, sourceName: "Indian Kanoon", label: "Homebuyers Association vs Adarsh Infrastructure & Realty Holdings", url: "https://indiankanoon.org/doc/205/" },
    { ref: 9, sourceName: "Google / News", label: "Adarsh Infrastructure auditor flags going-concern doubt", url: "https://news.example.com/ad5" },
    { ref: 10, sourceName: "Google / News", label: "Adarsh Realty defaults on NCD interest payment", url: "https://news.example.com/ad6" },
  ];

  const sections: RenderedSection[] = [
    {
      id: "red-flags",
      title: "Key Concerns",
      findings: [
        { severity: "red", text: "SFIO is probing alleged diversion of homebuyer funds.", sourceRef: 1 },
        { severity: "red", text: "CIBIL suit-filed / defaulter records found — Rs 84.5 crore outstanding to a lender consortium.", sourceRef: 2 },
        { severity: "red", text: "CBI has named the promoter in a preliminary enquiry.", sourceRef: 3 },
        { severity: "red", text: "ED has attached company assets in a money-laundering case.", sourceRef: 4 },
        { severity: "amber", text: "5 litigation record(s) surfaced on Indian Kanoon, including DRT recovery proceedings.", sourceRef: 5 },
        { severity: "amber", text: "Auditor has flagged a going-concern doubt in recent coverage.", sourceRef: 9 },
      ],
    },
  ];

  return {
    id: "mock_max",
    subject: {
      type: "company",
      company: "Adarsh Infrastructure & Realty Holdings (India) Private Limited",
      promoters: ["Rajesh Kumar Verma", "Sunita Rajesh Verma"],
    },
    status: "complete",
    createdAt: CREATED,
    progress,
    collected,
    brief: {
      verdict: "red",
      headline: "Serious governance red flags for Adarsh Infrastructure — active SFIO/CBI/ED scrutiny and a large suit-filed default. Do not proceed without deep diligence.",
      sections,
      citations,
      synthesizedBy: "ai",
    },
  };
}

// ── helper ────────────────────────────────────────────────────────────────────

function director(name: string, designation: string, din: string, tenure: string, cin: string) {
  return {
    title: `${name} — ${designation} — DIN ${din} — ${tenure} tenure`,
    url: `https://tofler.in/x/company/${cin}`,
    entity: "subject",
    extra: { category: "director", name, din, designation, tenure, cin },
  };
}
