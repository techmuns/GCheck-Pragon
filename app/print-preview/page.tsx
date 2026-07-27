import { notFound } from "next/navigation";
import PreviewClient from "./PreviewClient";

// QA harness for the one-page print brief. Development-only — it renders the
// print document with synthetic datasets so the fixed layout can be checked at
// short / average / maximum density. Never exposed in a production build.
export const dynamic = "force-static";

export default function PrintPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <PreviewClient />;
}
