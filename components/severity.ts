import type { Severity } from "@/lib/types";

// ── Signal palette ──────────────────────────────────────────────────────────
// Saturated marks on pastel surfaces. That split is what lets the page read as
// institutional rather than as a warning label: the tint carries the mood at
// large sizes, the dot carries the signal at small ones, and neither has to
// compromise for the other.
//
// The `dot` set is validated, not chosen by eye — the previous amber and red
// sat ΔE 10 apart to normal vision and 5.2 under deuteranopia, which for a risk
// dashboard means the two states a reader most needs to tell apart were the two
// hardest to. These pass the lightness band, chroma floor, CVD separation and
// contrast checks together:
//
//   #A32C3F  #C08A1E  #1E7A54  #2E6AAF   → all checks pass
//
// `text` is a darker step of the same hue, because a mark that reads well as a
// 8px dot on white does not necessarily clear 4.5:1 as body copy — amber in
// particular does not.

export const severityStyle: Record<
  Severity,
  { dot: string; tint: string; border: string; chip: string; label: string; text: string; ink: string }
> = {
  red: {
    dot: "#A32C3F",
    tint: "#FBF1F2",
    border: "rgba(163,44,63,0.20)",
    chip: "bg-[#FBF1F2] text-[#8E2436] border border-[rgba(163,44,63,0.20)]",
    label: "Red flag",
    text: "text-[#8E2436]",
    ink: "#8E2436",
  },
  amber: {
    dot: "#C08A1E",
    tint: "#FDF7EA",
    border: "rgba(192,138,30,0.22)",
    chip: "bg-[#FDF7EA] text-[#7C5A0F] border border-[rgba(192,138,30,0.22)]",
    label: "Watch",
    text: "text-[#7C5A0F]",
    ink: "#7C5A0F",
  },
  clear: {
    dot: "#1E7A54",
    tint: "#ECF4F0",
    border: "rgba(30,122,84,0.20)",
    chip: "bg-[#ECF4F0] text-[#186045] border border-[rgba(30,122,84,0.20)]",
    label: "Clear",
    text: "text-[#186045]",
    ink: "#186045",
  },
  info: {
    dot: "#2E6AAF",
    tint: "#EFF4FA",
    border: "rgba(46,106,175,0.18)",
    chip: "bg-[#EFF4FA] text-[#2A5892] border border-[rgba(46,106,175,0.18)]",
    label: "Note",
    text: "text-[#2A5892]",
    ink: "#2A5892",
  },
};
