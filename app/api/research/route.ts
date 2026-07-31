import { NextRequest, NextResponse } from "next/server";
import { getConfig, createRun } from "@/lib/store";
import { deadlineFor, runWorkflow } from "@/lib/workflow";
import { parseDirectorInput } from "@/lib/directorId";
import type { SourceProgress, Subject } from "@/lib/types";

export const dynamic = "force-dynamic";

// POST /api/research — trigger a research run.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const type: Subject["type"] = body.type === "director" ? "director" : "company";
  const raw = (body.company ?? "").toString().trim();
  // The director box carries more than a name when it can: a DIN the user typed
  // straight in, or the DIN + company that came back on an autocomplete pick.
  // Reading it apart here is what lets one field supply a whole identity.
  const parsed = type === "director" ? parseDirectorInput(raw) : null;
  // A DIN typed on its own has no name yet — it stands in as the subject's
  // label until the workflow resolves the record and fills the real one in.
  const company = parsed ? parsed.name || raw : raw;
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
  const subject: Subject = {
    type,
    company,
    promoters,
    ticker,
    din: parsed?.din,
    anchors: parsed?.anchorCompany ? [parsed.anchorCompany] : undefined,
  };

  const progressSeed: SourceProgress[] = config.sources
    .filter((s) => s.enabled)
    .map((s) => ({
      sourceId: s.id,
      name: s.name,
      kind: s.kind,
      status: "pending" as const,
      // Carried so the client can count the wait down against the deadline
      // this source will actually be held to.
      budgetMs: deadlineFor(s.id),
    }));

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
