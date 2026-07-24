import type { AppConfig } from "./types";

// ── Seed configuration ─────────────────────────────────────────────────────
// Defaults drawn straight from the client governance checklist. Everything
// here becomes editable in the Phase 4 admin panel.

export const defaultConfig: AppConfig = {
  sources: [
    {
      id: "google",
      name: "Google / News",
      kind: "api",
      description: "Company + promoter searches across the red-flag keyword set; negative-press sweep.",
      enabled: true,
      url: "https://www.google.com",
    },
    {
      id: "indiankanoon",
      name: "Indian Kanoon",
      kind: "api",
      description: "Litigation search for company and promoters. Last 5 cases by relevance — heading + link.",
      enabled: true,
      url: "https://indiankanoon.org",
      locked: true,
      lockReason: "Requires the paid Indian Kanoon API token (their public search blocks servers).",
    },
    {
      id: "privatecircle",
      name: "PrivateCircle",
      kind: "browser",
      description: "Directorships — other companies where directors serve, plus past directors.",
      enabled: true,
      url: "https://www.privatecircle.co",
      locked: true,
      lockReason: "Requires a paid server for browser automation, plus the PrivateCircle login.",
    },
    {
      id: "cibil",
      name: "CIBIL Suit-Filed",
      kind: "browser",
      description: "Defaulters > Rs 1 cr and > Rs 25 lakh, by company and promoter, across recent periods.",
      enabled: true,
      url: "https://suit.cibil.com",
      locked: true,
      lockReason: "Requires a paid server for browser automation, plus the CIBIL login.",
    },
  ],

  // From the checklist, plus the note "(pls add relevant ones)".
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
  ].map((term, i) => ({ id: `kw-${i + 1}`, term, enabled: true })),

  sections: [
    { id: "red-flags", title: "Red-Flag Summary", hint: "The verdict up top — what a partner must know before the meeting.", enabled: true, order: 0 },
    { id: "snapshot", title: "Company Snapshot", hint: "Who they are, in one glance.", enabled: true, order: 1 },
    { id: "management", title: "Key Management & Promoters", hint: "The people behind the company.", enabled: true, order: 2 },
    { id: "litigation", title: "Litigation (Indian Kanoon)", hint: "Court cases touching the company or promoters.", enabled: true, order: 3 },
    { id: "defaulters", title: "Defaulter Checks (CIBIL)", hint: "Suit-filed / wilful-defaulter exposure.", enabled: true, order: 4 },
    { id: "directorships", title: "Directorships (PrivateCircle)", hint: "Other and past directorships — hidden connections.", enabled: true, order: 5 },
    { id: "press", title: "Recent Press & News", hint: "Negative coverage worth a partner's attention.", enabled: true, order: 6 },
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
