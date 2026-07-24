import { NextRequest, NextResponse } from "next/server";
import { getConfig, createRun } from "@/lib/store";
import { runWorkflow } from "@/lib/workflow";
import type { SourceProgress, Subject } from "@/lib/types";

export const dynamic = "force-dynamic";

// POST /api/research — trigger a research run.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const company = (body.company ?? "").toString().trim();
  const promoters: string[] = Array.isArray(body.promoters)
    ? body.promoters.map((p: unknown) => String(p).trim()).filter(Boolean)
    : [];

  if (!company) {
    return NextResponse.json({ error: "Company name is required." }, { status: 400 });
  }

  const config = await getConfig();
  const subject: Subject = { company, promoters };

  const progressSeed: SourceProgress[] = config.sources
    .filter((s) => s.enabled)
    .map((s) => ({ sourceId: s.id, name: s.name, kind: s.kind, status: "pending" as const }));

  const run = createRun(subject, progressSeed);

  // Fire the workflow without blocking the response.
  void runWorkflow(run.id);

  return NextResponse.json({ id: run.id });
}
