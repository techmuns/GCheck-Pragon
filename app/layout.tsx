import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Paragon — Pre-Meeting Research",
  description: "Governance red-flag pre-screen for pre-meeting due diligence.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
