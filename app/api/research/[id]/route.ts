import { NextRequest, NextResponse } from "next/server";
import { getRun } from "@/lib/store";
import { bearerFrom, rememberRunToken } from "@/lib/hostToken";

export const dynamic = "force-dynamic";

// GET /api/research/:id — poll a run's status and result.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const run = getRun(params.id);
  if (!run) {
    return NextResponse.json({ error: "Run not found." }, { status: 404 });
  }
  // A deep run works for minutes, and the session token it started with can
  // lapse inside that window. The client polls twice a second carrying whatever
  // token the host has most recently given it, so the poll is also how a
  // refreshed token reaches the sources still running.
  rememberRunToken(params.id, bearerFrom(req));
  return NextResponse.json(run);
}
