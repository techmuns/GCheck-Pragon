import type { Config } from "tailwindcss";

// Paragon Partners design system — tokens lifted verbatim from DESIGNSYSTEM.md
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        navy: { DEFAULT: "#243F78", primary: "#27457E", deep: "#172B4D" },
        royal: "#315AA9",
        muted: { blue: "#3D5F9F" },
        soft: { blue: "#EEF4FF", border: "#E1E6EF" },
        ice: "#F4F7FC",
        ivory: "#F6F4EF",
        surface: { DEFAULT: "#FCFCFB", tint: "#F6F9FD", band: "#F8F9FB" },
        card: "#FFFFFF",
        ink: { primary: "#26303F", secondary: "#6B7280" },
        signal: { positive: "#2F855A", warning: "#B7791F", negative: "#B94A48" },
        teal: { DEFAULT: "#168E8E", soft: "#E1F2F1" },
        emerald: { DEFAULT: "#2F855A", soft: "#E6F1EB" },
        gold: { DEFAULT: "#B7791F", soft: "#FBF3E2" },
        coral: { DEFAULT: "#C75D54", soft: "#F8ECEC" },
        lavender: { DEFAULT: "#6E7BD6", soft: "#ECEEFB" },
        champagne: { DEFAULT: "#B68B3A", deep: "#9C7430", soft: "#F4ECDB" },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "Arial", "sans-serif"],
        display: ["Fraunces", "Georgia", "ui-serif", "serif"],
        editorial: ['"Cormorant Garamond"', "Georgia", "ui-serif", "serif"],
      },
      boxShadow: {
        soft: "0 1px 2px rgba(23,43,77,0.05), 0 10px 24px rgba(23,43,77,0.08)",
        card: "0 1px 3px rgba(23,43,77,0.05), 0 16px 38px rgba(23,43,77,0.10)",
        lift: "0 18px 46px rgba(23,43,77,0.14)",
        bar: "0 3px 20px rgba(23,43,77,0.07)",
      },
      borderRadius: { xl2: "1.25rem" },
      transitionTimingFunction: {
        DEFAULT: "cubic-bezier(0.22,1,0.36,1)",
        premium: "cubic-bezier(0.22,1,0.36,1)",
      },
      transitionDuration: {
        DEFAULT: "200ms",
        fast: "160ms",
        normal: "240ms",
        slow: "320ms",
      },
    },
  },
  plugins: [],
};

export default config;
