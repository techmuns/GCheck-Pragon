import type { Run, Severity } from "@/lib/types";

// ── Server-side PDF report ──────────────────────────────────────────────────
// Builds a self-contained HTML document for the downloadable brief. This mirrors
// the on-screen brief's PRINT view (see the `@media print` block + `.no-print`
// markers in BriefView): a clean single-column report — title → verdict line →
// sections → sources — with the decorative widgets left off. The API route feeds
// this straight to Playwright's `page.pdf()`, so the user gets a real PDF file
// on click instead of the browser's print dialog.

// Signal colours — kept in step with components/severity.ts and the verdict
// palette in components/BriefViz.tsx. Duplicated (not imported) so this module
// stays free of the client-only ("use client") component graph.
const DOT: Record<Severity, string> = {
  red: "#C75D54",
  amber: "#B7791F",
  clear: "#2F855A",
  info: "#3D7DD6",
};

const VERDICT: Record<Severity, { label: string; color: string; soft: string }> = {
  red: { label: "Red Flags", color: "#C0392B", soft: "#FAE8E5" },
  amber: { label: "Review", color: "#B7791F", soft: "#F6EED9" },
  clear: { label: "Clear", color: "#2F855A", soft: "#E7F5F1" },
  info: { label: "Limited", color: "#6B7280", soft: "#EEF2F8" },
};

/** HTML-escape a dynamic string for safe interpolation into the report. */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** A filesystem-friendly base name for the downloaded file (no extension). */
export function reportFileName(run: Run): string {
  const subject = run.subject.company?.trim() || "Pre-Screen";
  const safe = subject.replace(/[^\p{L}\p{N}\-_. ]/gu, "").trim() || "Pre-Screen";
  return `Pre-Screen — ${safe}`;
}

/** Full standalone HTML document for the brief, ready for Playwright → PDF. */
export function briefReportHtml(run: Run): string {
  const brief = run.brief;
  if (!brief) throw new Error("Run has no brief to render.");
  const meta = VERDICT[brief.verdict] ?? VERDICT.info;

  const subjectLine =
    run.subject.promoters.length > 0
      ? `<p class="promoters">${esc(run.subject.promoters.join(" · "))}</p>`
      : "";

  const sections = brief.sections
    .map((section) => {
      const empty = section.empty || section.findings.length === 0;
      const body = empty
        ? `<p class="empty">n/a — no source-backed findings</p>`
        : `<ul>${section.findings
            .map((f) => {
              const ref =
                f.sourceRef !== undefined
                  ? `<sup class="ref">[${f.sourceRef}]</sup>`
                  : "";
              return `<li><span class="dot" style="background:${DOT[f.severity] ?? DOT.info}"></span><span class="finding">${esc(f.text)}${ref}</span></li>`;
            })
            .join("")}</ul>`;
      const isSummary = section.id === "red-flags";
      return `<section class="block${isSummary ? " summary" : ""}"${
        isSummary ? ` style="border-left:3px solid ${meta.color}"` : ""
      }><h3>${esc(section.title)}</h3>${body}</section>`;
    })
    .join("");

  const sources =
    brief.citations.length > 0
      ? `<section class="sources"><div class="eyebrow">Sources</div><ol>${brief.citations
          .map(
            (c) =>
              `<li><span class="cref">[${c.ref}]</span> ${esc(c.sourceName)} — ${esc(c.label)}${
                c.url ? ` <span class="url">${esc(c.url)}</span>` : ""
              }</li>`,
          )
          .join("")}</ol></section>`
      : "";

  const disclaimer =
    brief.synthesizedBy === "ai"
      ? "Summary written by AI from live source data — every claim links to a source above. Illustrative pre-screen; verify before relying."
      : "Assembled from live source data. Illustrative pre-screen; verify before relying.";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(reportFileName(run))}</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: Georgia, "Times New Roman", serif;
    color: #1a2233;
    background: #ffffff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
    font-size: 12px;
    line-height: 1.5;
  }
  .page { padding: 4px 2px; }
  .brand {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    font-size: 10px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: #6B7280;
    margin-bottom: 14px;
  }
  h2.subject {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    font-size: 22px;
    color: #172B4D;
    margin: 0 0 2px;
    line-height: 1.15;
  }
  .promoters { margin: 0 0 12px; color: #55617A; font-size: 12px; }
  .verdict {
    border: 1px solid ${meta.color}55;
    background: ${meta.soft};
    border-radius: 10px;
    padding: 12px 14px;
    margin: 12px 0 16px;
  }
  .eyebrow {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    font-size: 9.5px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: #6B7280;
    margin-bottom: 4px;
  }
  .verdict .badge { font-weight: 700; color: ${meta.color}; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; }
  .verdict .headline { margin: 6px 0 0; font-size: 16px; line-height: 1.35; color: #172B4D; }
  section.block { margin: 0 0 12px; page-break-inside: avoid; }
  section.block h3 {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    font-size: 13px;
    color: #172B4D;
    margin: 0 0 5px;
  }
  section.summary { padding-left: 10px; }
  ul { list-style: none; margin: 0; padding: 0; }
  li { display: flex; align-items: flex-start; gap: 8px; margin: 0 0 5px; }
  .dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-top: 5px; flex: 0 0 auto; }
  .finding { font-size: 12.5px; color: #1f2937; }
  .ref { font-size: 9px; color: rgba(23,43,77,0.7); font-weight: 700; margin-left: 2px; }
  .empty { font-style: italic; color: #9AA6B6; font-size: 12px; margin: 0; }
  .sources {
    margin-top: 14px;
    border: 1px solid #E3E8F0;
    background: #F7F9FC;
    border-radius: 8px;
    padding: 10px 12px;
  }
  .sources ol { margin: 0; padding-left: 0; list-style: none; }
  .sources li { display: block; font-size: 11px; color: #55617A; margin: 0 0 3px; }
  .cref { font-weight: 700; color: rgba(23,43,77,0.7); }
  .url { color: #3D5F9F; word-break: break-all; }
  .disclaimer { margin-top: 14px; font-size: 9px; color: rgba(85,97,122,0.75); }
</style>
</head>
<body>
  <div class="page">
    <div class="brand">Paragon Partners · Pre-Meeting Governance Pre-Screen</div>
    <h2 class="subject">${esc(run.subject.company)}</h2>
    ${subjectLine}
    <div class="verdict">
      <div class="eyebrow">The verdict</div>
      <span class="badge">${esc(meta.label)}</span>
      <p class="headline">${esc(brief.headline)}</p>
    </div>
    ${sections}
    ${sources}
    <p class="disclaimer">${esc(disclaimer)}</p>
  </div>
</body>
</html>`;
}
