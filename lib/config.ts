import type { AppConfig } from "./types";

// ── Seed configuration ─────────────────────────────────────────────────────
// Defaults drawn straight from the client governance checklist. Everything
// here becomes editable in the Phase 4 admin panel.

export const defaultConfig: AppConfig = {
  sources: [
    {
      // Listed first because it answers "who is this?" — and until that is
      // settled, every other source is searching a name rather than a person.
      id: "indiafilings",
      name: "MCA Registry (IndiaFilings)",
      kind: "api",
      description:
        "The MCA register: who a DIN belongs to, every company and LLP linked to it, and whether those entities are in good standing. Free and keyless.",
      enabled: true,
      url: "https://www.indiafilings.com",
    },
    {
      id: "google",
      name: "Google & News",
      kind: "api",
      description: "Searches Google and the news for anything concerning about the company and its people.",
      enabled: true,
      url: "https://www.google.com",
    },
    {
      id: "news",
      name: "News Deep Dive",
      kind: "api",
      description:
        "Searches the news for the person, for each company the register links to them, and for both against the red-flag terms — then reads the articles that matter.",
      enabled: true,
      url: "https://fastapi.muns.io",
    },
    {
      id: "indiankanoon",
      name: "Court Cases",
      kind: "api",
      description: "Court cases involving the company or its people.",
      enabled: true,
      url: "https://indiankanoon.org",
    },
    {
      id: "registry",
      name: "Company Registry (Tofler)",
      kind: "api",
      description: "Free public registry record — directors, designations and DINs, including for unlisted companies.",
      enabled: true,
      url: "https://www.tofler.in",
    },
    {
      id: "wikidata",
      name: "Wikidata (Directors)",
      kind: "api",
      description: "Free public source for a company's directors, CEO and founders — and the companies a person leads.",
      enabled: true,
      url: "https://www.wikidata.org",
    },
    {
      id: "profile",
      name: "Profile & Background",
      kind: "api",
      description:
        "The public profile of the person or company — role, net worth and ranking where a source publishes one, biography and career milestones — read from sources like Forbes and Wikipedia.",
      enabled: true,
      url: "https://www.forbes.com",
    },
    {
      // Listed-company only (keys off a stock ticker), so disabled by default —
      // this tool targets unlisted-company due diligence. The collector stays
      // registered and can be re-enabled from the admin panel if a listed
      // subject ever comes up.
      id: "filings",
      name: "Filings & Disclosures",
      kind: "api",
      description: "Exchange filings, annual reports, earnings and concalls (BSE/NSE). Listed companies only.",
      enabled: false,
      url: "https://www.bseindia.com",
    },
    {
      id: "privatecircle",
      name: "Company & Directors",
      kind: "browser",
      description: "Other companies the directors are involved with, and past directors.",
      enabled: true,
      url: "https://www.privatecircle.co",
      locked: true,
      lockReason: "Available on the upgraded plan.",
    },
    {
      id: "cibil",
      name: "Loan Defaults",
      kind: "browser",
      description: "Loan-default and defaulter records for the company and its people.",
      enabled: true,
      url: "https://suit.cibil.com",
      locked: true,
      lockReason: "Available on the upgraded plan.",
    },
  ],

  // From the checklist, plus the note "(pls add relevant ones)".
  //
  // Extended to the full vocabulary a manual governance check actually clears:
  // the analyst files we benchmarked against close with "no evidence of
  // criminal proceedings, GST, Income Tax, Customs, Excise, CBI, EOW, or
  // political affiliation" — and the one material finding among them (an ED
  // arrest over an alleged ₹1,500cr MLM scheme, PMLA attachment through
  // related entities) sat entirely under terms the old list never searched.
  // Keywords are OR-batched into single queries, so breadth here costs almost
  // no extra search quota.
  keywords: [
    "lawsuit",
    "legal",
    "court",
    "criminal",
    "civil",
    "cbi",
    "eow",
    "fraud",
    "default",
    "defaulter",
    "wilful",
    "police",
    "enforcement directorate",
    "PMLA",
    "money laundering",
    "NCLT",
    "insolvency",
    "SFIO",
    "SEBI",
    "GST",
    "income tax",
    "customs",
    "excise",
    "ponzi",
    "pyramid scheme",
    "political",
  ].map((term, i) => ({ id: `kw-${i + 1}`, term, enabled: true })),

  sections: [
    { id: "red-flags", title: "Key Concerns", hint: "The most important things to know before the meeting.", enabled: true, order: 0 },
    // Who this person or company actually is — the background a partner wants
    // before the meeting, read from public profiles (Forbes, Wikipedia, …).
    { id: "profile", title: "Profile & Background", hint: "Who they are and what they've done, from public profiles.", enabled: true, order: 1 },
    { id: "snapshot", title: "Company Snapshot", hint: "Who they are, in one glance.", enabled: true, order: 2 },
    { id: "management", title: "Key People", hint: "The people behind the company.", enabled: true, order: 3 },
    { id: "directorships", title: "Company & Directors", hint: "Other and past companies the directors are involved with.", enabled: true, order: 4 },
    { id: "litigation", title: "Court Cases", hint: "Court cases involving the company or its people.", enabled: true, order: 5 },
    { id: "defaulters", title: "Loan Defaults", hint: "Loan-default and defaulter records.", enabled: true, order: 6 },
    { id: "filings", title: "Filings & Disclosures", hint: "Exchange filings, annual reports and earnings — listed companies only.", enabled: false, order: 7 },
    { id: "press", title: "Recent News", hint: "Recent coverage worth attention.", enabled: true, order: 8 },
    // Good news is not a concern. Without somewhere of its own to go it was
    // being written into Key Concerns, where an award read as a governance risk.
    { id: "positives", title: "Positive Signals", hint: "Recognitions, funding and a clean registry standing.", enabled: true, order: 9 },
  ],

  synthesisPrompt: [
    "You are a governance due-diligence analyst preparing a one-page pre-meeting brief for investment partners.",
    "You are given structured EVIDENCE gathered from multiple sources about a company and its promoters.",
    "",
    "Write a crisp, decision-grade brief. Rules — follow them exactly:",
    "1. Use ONLY the evidence provided. Never invent facts, names, numbers, cases, or sources.",
    "2. Every factual finding must cite a source using its [ref] number from the evidence. Do not cite a ref that is not in the evidence.",
    "3. Rank severity honestly: 'red' for serious governance risk (fraud, wilful default, criminal/CBI/EOW matters, suit-filed defaulter records); 'amber' for items warranting review (litigation, adverse press, keyword hits); 'clear' for verified-clean checks; 'info' for context or unavailable sources.",
    "4. If a source was unavailable or not run, say so plainly as an 'info' finding — do not guess what it might have contained, and do not treat its absence as 'clear'.",
    "4a. If a source status is 'locked', it is gated behind a paid upgrade. For that source's section add exactly one 'info' finding worded: '🔒 Upgrade to enable — <the reason given>'. Never treat a locked source as clear or as risk.",
    "5. Keep each finding to one tight sentence. A partner reads this in under a minute.",
    "6. The Red-Flag Summary must lead with the sharpest risks; if there are none from completed sources, say so honestly.",
    "7. Set the overall verdict to the single worst severity among real findings (unavailable sources never raise the verdict).",
  ].join("\n"),
};
