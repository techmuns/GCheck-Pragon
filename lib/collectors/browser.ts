import { existsSync, readdirSync } from "fs";
import path from "path";
import { chromium, type Browser, type Page } from "playwright";

// ── Shared Playwright launch helper ────────────────────────────────────────
// Resolves a usable Chromium binary. Prefers Playwright's own resolution; falls
// back to the pre-installed browser under PLAYWRIGHT_BROWSERS_PATH when the
// bundled revision differs from what's on disk.

function resolveExecutable(): string | undefined {
  // 1. Playwright's own guess, if the file exists.
  try {
    const p = chromium.executablePath();
    if (p && existsSync(p)) return p;
  } catch {
    /* fall through */
  }
  // 2. Scan the browsers dir for any chromium-*/chrome-linux/chrome.
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
  try {
    const dirs = readdirSync(root).filter((d) => d.startsWith("chromium-"));
    for (const d of dirs) {
      const candidate = path.join(root, d, "chrome-linux", "chrome");
      if (existsSync(candidate)) return candidate;
    }
  } catch {
    /* no dir */
  }
  return undefined;
}

export async function launchBrowser(): Promise<Browser> {
  const executablePath = resolveExecutable();
  return chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
}

/** Run a task with a fresh browser + page, always cleaning up. */
export async function withPage<T>(task: (page: Page) => Promise<T>): Promise<T> {
  const browser = await launchBrowser();
  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      viewport: { width: 1366, height: 900 },
    });
    const page = await context.newPage();
    return await task(page);
  } finally {
    await browser.close();
  }
}
