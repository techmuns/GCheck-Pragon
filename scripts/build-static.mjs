// ── Static frontend build for Cloudflare Pages ─────────────────────────────
// Next's `output: 'export'` can't include dynamic API route handlers or
// middleware, so we temporarily move them aside, build the static UI into
// `out/`, then always restore them. The API lives on the Node backend.
//
// Usage:
//   NEXT_PUBLIC_API_BASE=https://your-backend npm run build:static

import { execSync } from "node:child_process";
import { existsSync, renameSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const STASH = path.join(root, ".static-stash");

// [ live path, stashed path ]
const MOVES = [
  [path.join(root, "app", "api"), path.join(STASH, "api")],
  [path.join(root, "middleware.ts"), path.join(STASH, "middleware.ts")],
];

function stash() {
  mkdirSync(STASH, { recursive: true });
  for (const [live, hidden] of MOVES) {
    if (existsSync(live)) renameSync(live, hidden);
  }
}

function restore() {
  for (const [live, hidden] of MOVES) {
    if (existsSync(hidden)) renameSync(hidden, live);
  }
  if (existsSync(STASH)) rmSync(STASH, { recursive: true, force: true });
}

console.log("→ Building static frontend for Cloudflare Pages…");
if (!process.env.NEXT_PUBLIC_API_BASE) {
  console.warn("⚠  NEXT_PUBLIC_API_BASE is not set — the UI will call the same origin, which has no API in a static deploy.");
}

stash();
try {
  execSync("next build", {
    stdio: "inherit",
    env: { ...process.env, STATIC_EXPORT: "1" },
  });
  console.log("✓ Static site written to ./out");
} finally {
  restore();
  console.log("✓ Restored API routes + middleware");
}
