"use client";

import { useEffect, useState } from "react";
import BriefPrint, { type PrintVariant } from "@/components/BriefPrint";
import { buildPrintBrief, formatGenerated } from "@/lib/printBrief";
import type { Run } from "@/lib/types";

// ── Headless render target for the downloadable PDF ─────────────────────────
// The Download button's PDF is produced by driving Chromium (server-side, in
// the /api/research/[id]/pdf route) over THIS page, so the exported file is the
// exact same one-page A4 brief as the on-screen print — a single source of
// truth (BriefPrint), never a second layout to keep in sync.
//
// A query param (?id=) rather than a path segment keeps this compatible with
// the static-export frontend build (no dynamic route to pre-generate). The page
// is print-only: BriefPrint portals itself to <body> and the print CSS reveals
// just that, which is what page.pdf() captures.
export default function PrintPage() {
  const [run, setRun] = useState<Run | null>(null);
  const [missing, setMissing] = useState(false);
  // Which document to export. Read from the URL rather than passed down,
  // because the only caller is a headless browser opening this page.
  const [variant, setVariant] = useState<PrintVariant>("detailed");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("id");
    if (params.get("variant") === "onepager") setVariant("onepager");
    if (!id) {
      setMissing(true);
      return;
    }
    let alive = true;
    // Same-origin on the backend that serves this page and the API.
    fetch(`/api/research/${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("not found"))))
      .then((data: Run) => {
        if (alive) setRun(data);
      })
      .catch(() => {
        if (alive) setMissing(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (missing) return <div data-print-error="1" style={{ padding: 24 }}>Brief unavailable.</div>;
  if (!run?.brief) return null;

  const brief = buildPrintBrief(run, formatGenerated(run.createdAt));
  if (!brief) return null;
  return <BriefPrint brief={brief} variant={variant} />;
}
