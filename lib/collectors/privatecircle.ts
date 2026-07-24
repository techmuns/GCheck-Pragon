import type { CollectorResult, RawHit } from "../types";
import { env, hasPrivateCircleCreds } from "./env";
import { withPage } from "./browser";
import type { Collector } from "./types";

// ── PrivateCircle collector (Playwright) ───────────────────────────────────
// Logs in, searches the company, opens Directors, and captures:
//   • other companies where the directors serve
//   • the list of past directors
//
// Credential-gated: without PRIVATECIRCLE_EMAIL / PRIVATECIRCLE_PASSWORD it
// skips honestly. Selectors live in one block below so they can be tuned
// against the live portal when credentials are wired in.

const SELECTORS = {
  loginUrl: "https://www.privatecircle.co/login",
  emailInput: 'input[type="email"], input[name="email"]',
  passwordInput: 'input[type="password"], input[name="password"]',
  submit: 'button[type="submit"]',
  searchInput: 'input[type="search"], input[placeholder*="Search" i]',
  directorsTab: 'a:has-text("Directors"), button:has-text("Directors")',
  // Rows in the directorships / past-directors tables.
  directorshipRow: "table tbody tr",
};

export const privateCircleCollector: Collector = async ({ subject }) => {
  const base: Omit<CollectorResult, "status" | "hits"> = {
    sourceId: "privatecircle",
    sourceName: "PrivateCircle",
    kind: "browser",
  };

  if (!hasPrivateCircleCreds()) {
    return {
      ...base,
      status: "skipped",
      note: "PrivateCircle credentials not configured (set PRIVATECIRCLE_EMAIL / PRIVATECIRCLE_PASSWORD).",
      hits: [],
    };
  }

  try {
    const hits = await withPage(async (page) => {
      const out: RawHit[] = [];

      // 1. Log in.
      await page.goto(SELECTORS.loginUrl, { waitUntil: "domcontentloaded" });
      await page.fill(SELECTORS.emailInput, env.privateCircleEmail!);
      await page.fill(SELECTORS.passwordInput, env.privateCirclePassword!);
      await page.click(SELECTORS.submit);
      await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});

      // 2. Search the company.
      const search = page.locator(SELECTORS.searchInput).first();
      await search.fill(subject.company);
      await search.press("Enter");
      await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});

      // 3. Open Directors and read the directorship rows.
      await page.locator(SELECTORS.directorsTab).first().click().catch(() => {});
      await page.waitForTimeout(1500);

      const rows = await page.locator(SELECTORS.directorshipRow).allInnerTexts().catch(() => []);
      for (const text of rows) {
        const clean = text.replace(/\s+/g, " ").trim();
        if (clean) out.push({ title: clean, entity: subject.company, extra: { source: "directorships" } });
      }
      return out;
    });

    return {
      ...base,
      status: "done",
      note:
        hits.length === 0
          ? "Logged in but no directorship rows parsed — selectors may need tuning against the live portal."
          : undefined,
      hits,
    };
  } catch (err) {
    return {
      ...base,
      status: "error",
      note: `PrivateCircle automation failed: ${err instanceof Error ? err.message : String(err)}`,
      hits: [],
    };
  }
};
