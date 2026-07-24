import type { CollectorResult, RawHit } from "../types";
import { entitiesOf } from "../queries";
import { env, hasCibilCreds } from "./env";
import { withPage } from "./browser";
import type { Collector } from "./types";

// ── CIBIL Suit-Filed collector (Playwright) ────────────────────────────────
// Checks the suit-filed / defaulter portal (suit.cibil.com) for the company
// and each promoter, across both defaulter categories:
//   • Defaulters > Rs 1 crore
//   • Defaulters > Rs 25 lakh
//
// Credential-gated: without CIBIL_USERNAME / CIBIL_PASSWORD it skips honestly.
// Selectors are collected in one block for tuning against the live portal.

const SELECTORS = {
  loginUrl: "https://suit.cibil.com/",
  usernameInput: 'input[name="username"], input[type="text"]',
  passwordInput: 'input[type="password"]',
  submit: 'button[type="submit"], input[type="submit"]',
  categorySelect: 'select[name="category"]',
  nameInput: 'input[name="name"], input[placeholder*="name" i]',
  searchButton: 'button:has-text("Search"), input[type="submit"]',
  resultRow: "table tbody tr",
};

const CATEGORIES = [
  { key: "gt-1cr", label: "Defaulters > Rs 1 cr" },
  { key: "gt-25l", label: "Defaulters > Rs 25 lakh" },
];

export const cibilCollector: Collector = async ({ subject }) => {
  const base: Omit<CollectorResult, "status" | "hits"> = {
    sourceId: "cibil",
    sourceName: "CIBIL Suit-Filed",
    kind: "browser",
  };

  if (!hasCibilCreds()) {
    return {
      ...base,
      status: "skipped",
      note: "CIBIL credentials not configured (set CIBIL_USERNAME / CIBIL_PASSWORD).",
      hits: [],
    };
  }

  const entities = entitiesOf(subject);

  try {
    const hits = await withPage(async (page) => {
      const out: RawHit[] = [];

      // 1. Log in.
      await page.goto(SELECTORS.loginUrl, { waitUntil: "domcontentloaded" });
      await page.fill(SELECTORS.usernameInput, env.cibilUsername!);
      await page.fill(SELECTORS.passwordInput, env.cibilPassword!);
      await page.click(SELECTORS.submit);
      await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});

      // 2. For each entity × category, run a search and read the result rows.
      for (const e of entities) {
        for (const cat of CATEGORIES) {
          await page.selectOption(SELECTORS.categorySelect, { label: cat.label }).catch(() => {});
          const name = page.locator(SELECTORS.nameInput).first();
          await name.fill(e.name).catch(() => {});
          await page.locator(SELECTORS.searchButton).first().click().catch(() => {});
          await page.waitForTimeout(1500);

          const rows = await page.locator(SELECTORS.resultRow).allInnerTexts().catch(() => []);
          for (const text of rows) {
            const clean = text.replace(/\s+/g, " ").trim();
            if (clean) {
              out.push({
                title: clean,
                entity: e.name,
                extra: { category: cat.label },
              });
            }
          }
        }
      }
      return out;
    });

    return {
      ...base,
      status: "done",
      note:
        hits.length === 0
          ? "Logged in but no defaulter rows parsed — this is a genuine clear result, or selectors need tuning against the live portal."
          : undefined,
      hits,
    };
  } catch (err) {
    return {
      ...base,
      status: "error",
      note: `CIBIL automation failed: ${err instanceof Error ? err.message : String(err)}`,
      hits: [],
    };
  }
};
