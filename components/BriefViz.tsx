"use client";

import type { Severity, SourceProgress } from "@/lib/types";
import { severityStyle } from "./severity";

// ── Decision-grade visualisations for the brief ────────────────────────────
// Compact, signal-coded, on-brand. Colour is always meaning: red=risk,
// gold=review, green=clear, navy/grey=neutral.

const VERDICT_META: Record<Severity, { label: string; plain: string; color: string; soft: string }> = {
  red: { label: "Red Flags", plain: "Serious issues found — review before meeting", color: "#C0392B", soft: "#FAE8E5" },
  amber: { label: "Review", plain: "Some items to check before meeting", color: "#B7791F", soft: "#F6EED9" },
  clear: { label: "Clear", plain: "Nothing concerning surfaced", color: "#2F855A", soft: "#E7F5F1" },
  info: { label: "Limited", plain: "Only some sources ran", color: "#6B7280", soft: "#EEF2F8" },
};

// A 3-step risk scale with the current level lit — clearer than a gauge.
export function RiskMeter({ verdict }: { verdict: Severity }) {
  const order: Severity[] = ["clear", "amber", "red"];
  const activeIdx = order.indexOf(verdict);
  const meta = VERDICT_META[verdict] ?? VERDICT_META.info;

  return (
    <div>
      <div className="flex items-center gap-2">
        <span
          className="inline-flex items-center rounded-full px-3 py-1 text-[13px] font-bold uppercase tracking-wide"
          style={{ backgroundColor: meta.soft, color: meta.color, border: `1px solid ${meta.color}33` }}
        >
          {meta.label}
        </span>
        <span className="text-[13px] text-ink-secondary">{meta.plain}</span>
      </div>
      <div className="mt-2.5 flex gap-1.5" aria-hidden>
        {order.map((lvl, i) => {
          const m = VERDICT_META[lvl];
          const on = verdict !== "info" && i <= activeIdx;
          return (
            <div
              key={lvl}
              className="h-1.5 flex-1 rounded-full transition"
              style={{ backgroundColor: on ? m.color : "#E1E6EF" }}
            />
          );
        })}
      </div>
    </div>
  );
}

// Horizontal stacked bar of finding severities, with counts.
export function SeverityBar({ counts }: { counts: Record<Severity, number> }) {
  const total = counts.red + counts.amber + counts.clear;
  if (total === 0) return null;
  const segs: { sev: Severity; n: number }[] = (
    [
      { sev: "red", n: counts.red },
      { sev: "amber", n: counts.amber },
      { sev: "clear", n: counts.clear },
    ] as { sev: Severity; n: number }[]
  ).filter((s) => s.n > 0);

  return (
    <div>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-soft-border">
        {segs.map((s) => (
          <div
            key={s.sev}
            style={{ width: `${(s.n / total) * 100}%`, backgroundColor: severityStyle[s.sev].dot }}
            title={`${s.n} ${s.sev}`}
          />
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
        {segs.map((s) => (
          <span key={s.sev} className="inline-flex items-center gap-1 text-[11.5px] text-ink-secondary">
            <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: severityStyle[s.sev].dot }} />
            <span className="tabular font-semibold text-ink-primary">{s.n}</span> {label(s.sev)}
          </span>
        ))}
      </div>
    </div>
  );
}

function label(s: Severity): string {
  return s === "red" ? "red flags" : s === "amber" ? "to review" : "clear";
}

// A small stat tile.
export function StatTile({ value, label, tint }: { value: string | number; label: string; tint?: string }) {
  return (
    <div className="surface-soft px-3 py-2.5">
      <div className="tabular text-[20px] font-semibold leading-none" style={{ color: tint ?? "#26303F" }}>
        {value}
      </div>
      <div className="eyebrow mt-1 !text-[9px]">{label}</div>
    </div>
  );
}

// Source coverage strip — which of the sources ran vs need upgrade.
export function SourceCoverage({ progress }: { progress: SourceProgress[] }) {
  function icon(s: SourceProgress["status"]): { mark: string; color: string } {
    if (s === "done") return { mark: "✓", color: "#2F855A" };
    if (s === "locked") return { mark: "🔒", color: "#B68B3A" };
    if (s === "error") return { mark: "!", color: "#C75D54" };
    if (s === "skipped") return { mark: "–", color: "#94A3B8" };
    return { mark: "…", color: "#94A3B8" };
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {progress.map((p) => {
        const ic = icon(p.status);
        return (
          <span
            key={p.sourceId}
            className="inline-flex items-center gap-1.5 rounded-full border border-soft-border bg-white/70 px-2.5 py-1 text-[12px] text-ink-primary"
            title={p.note ?? p.status}
          >
            <span style={{ color: ic.color }}>{ic.mark}</span>
            {p.name}
          </span>
        );
      })}
    </div>
  );
}

export { VERDICT_META };
