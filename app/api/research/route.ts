import { NextRequest, NextResponse } from "next/server";
import { getConfig, createRun } from "@/lib/store";
import { runWorkflow } from "@/lib/workflow";
import type { SourceProgress, Subject } from "@/lib/types";

export const dynamic = "force-dynamic";

// POST /api/research — trigger a research run.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const type: Subject["type"] = body.type === "director" ? "director" : "company";
  const company = (body.company ?? "").toString().trim();
  // Promoters only apply to a company search; a director search is one person.
  const promoters: string[] =
    type === "company" && Array.isArray(body.promoters)
      ? body.promoters.map((p: unknown) => String(p).trim()).filter(Boolean)
      : [];
  const ticker = (body.ticker ?? "").toString().trim().toUpperCase() || undefined;

  if (!company) {
    return NextResponse.json(
      { error: type === "director" ? "Director name is required." : "Company name is required." },
      { status: 400 },
    );
  }

  const config = await getConfig();
  const subject: Subject = { type, company, promoters, ticker };

  const progressSeed: SourceProgress[] = config.sources
    .filter((s) => s.enabled)
    .map((s) => ({ sourceId: s.id, name: s.name, kind: s.kind, status: "pending" as const }));

  const run = createRun(subject, progressSeed);

  // Fire the workflow without blocking the response. runWorkflow contains its
  // own failures, but the catch here is the backstop that matters: an escaping
  // rejection from a detached promise takes the Node process down, and every
  // in-flight run with it.
  void runWorkflow(run.id).catch((err) => {
    console.error("[research] workflow rejected:", err);
  });

  return NextResponse.json({ id: run.id });
}
