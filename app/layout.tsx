import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Paragon — Pre-Meeting Research",
  description: "Governance red-flag pre-screen for pre-meeting due diligence.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Munshot Dashboard SDK — REQUIRED: classic script, in <head>, before
            the app bundle. Defines window.MunshotDashboardSDK, which lib/sdk.ts
            reads at import time. Do NOT add type="module", async, or defer:
            the bundle is an IIFE and load order decides whether
            createDashboardClientSdk is on the global at all.

            Deliberately a plain tag rather than next/script: `beforeInteractive`
            emits no script element, only a preload plus a runtime loader entry,
            so the global would not exist when lib/sdk.ts is evaluated and the
            client would fall back to the no-op — a dashboard that renders and
            never connects. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="https://munshot.s3.ap-south-1.amazonaws.com/SDK+script/munshot-dashboard-sdk.v1.0.0.min.js" />
      </head>
      <body>{children}</body>
    </html>
  );
}
