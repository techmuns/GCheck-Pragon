import { NextRequest, NextResponse } from "next/server";
import { getRun } from "@/lib/store";

export const dynamic = "force-dynamic";

// GET /api/research/:id — poll a run's status and result.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const run = getRun(params.id);
  if (!run) {
    return NextResponse.json({ error: "Run not found." }, { status: 404 });
  }
  return NextResponse.json(run);
}
