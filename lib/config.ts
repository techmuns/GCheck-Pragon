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
    },
    {
      id: "privatecircle",
      name: "PrivateCircle",
      kind: "browser",
      description: "Directorships — other companies where directors serve, plus past directors.",
      enabled: true,
      url: "https://www.privatecircle.co",
    },
    {
      id: "cibil",
      name: "CIBIL Suit-Filed",
      kind: "browser",
      description: "Defaulters > Rs 1 cr and > Rs 25 lakh, by company and promoter, across recent periods.",
      enabled: true,
      url: "https://suit.cibil.com",
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
};
