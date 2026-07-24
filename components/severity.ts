import type { Severity } from "@/lib/types";

// Maps governance severity onto the design-system signal psychology.
// Red is reserved for genuine risk only — that discipline is what makes it read.
export const severityStyle: Record<
  Severity,
  { dot: string; chip: string; label: string; text: string }
> = {
  red: {
    dot: "#C75D54",
    chip: "bg-coral-soft text-[#9B3D37] border border-[rgba(199,93,84,0.24)]",
    label: "Red flag",
    text: "text-[#9B3D37]",
  },
  amber: {
    dot: "#B7791F",
    chip: "bg-gold-soft text-[#8A5D14] border border-[rgba(182,139,58,0.26)]",
    label: "Watch",
    text: "text-[#8A5D14]",
  },
  clear: {
    dot: "#2F855A",
    chip: "bg-emerald-soft text-[#256B48] border border-[rgba(47,133,90,0.22)]",
    label: "Clear",
    text: "text-[#256B48]",
  },
  info: {
    dot: "#3D7DD6",
    chip: "bg-soft-blue text-muted-blue border border-[rgba(61,95,159,0.18)]",
    label: "Note",
    text: "text-muted-blue",
  },
};
