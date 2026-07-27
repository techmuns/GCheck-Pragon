"use client";

import { useEffect, useState, type CSSProperties } from "react";
import BriefPrint from "@/components/BriefPrint";
import { buildPrintBrief, formatGenerated } from "@/lib/printBrief";
import { mockRun, type Size } from "./mocks";

const SIZES: Size[] = ["short", "average", "max", "director"];

export default function PreviewClient() {
  const [size, setSize] = useState<Size>("average");

  useEffect(() => {
    document.body.classList.add("pb-preview");
    const p = new URLSearchParams(window.location.search).get("size");
    if (p && (SIZES as string[]).includes(p)) setSize(p as Size);
    return () => document.body.classList.remove("pb-preview");
  }, []);

  const run = mockRun(size);
  const brief = buildPrintBrief(run, formatGenerated(run.createdAt));

  const pick = (s: Size) => {
    setSize(s);
    const u = new URL(window.location.href);
    u.searchParams.set("size", s);
    window.history.replaceState({}, "", u);
  };

  return (
    <main style={host} className="no-print">
      <div style={bar}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#172B4D" }}>Print-brief preview</span>
        <span style={{ fontSize: 12, color: "#6B7280" }}>A4 landscape · one page</span>
        <div style={{ flex: 1 }} />
        {SIZES.map((s) => (
          <button key={s} onClick={() => pick(s)} style={{ ...btn, ...(s === size ? btnOn : {}) }}>
            {s}
          </button>
        ))}
        <button onClick={() => window.print()} style={{ ...btn, ...btnOn }}>
          Print / PDF
        </button>
      </div>
      <p style={{ fontSize: 12, color: "#6B7280", margin: 0 }}>
        The A4 page renders below (portalled to <code>&lt;body&gt;</code>). Use your browser&rsquo;s print dialog to export.
      </p>
      {/* Portalled to <body>; body.pb-preview reveals it on screen. */}
      {brief && <BriefPrint brief={brief} />}
    </main>
  );
}

const host: CSSProperties = {
  minHeight: "40vh",
  padding: 24,
  display: "flex",
  flexDirection: "column",
  gap: 12,
  background: "#e9eaec",
};

const bar: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
};

const btn: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  padding: "6px 12px",
  borderRadius: 8,
  border: "1px solid rgba(23,43,77,0.14)",
  background: "#ffffff",
  color: "#27457E",
  cursor: "pointer",
  textTransform: "capitalize",
};

const btnOn: CSSProperties = {
  background: "#27457E",
  color: "#ffffff",
  borderColor: "#27457E",
};
