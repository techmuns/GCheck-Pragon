import { NextResponse } from "next/server";
import { directorByDin, companyByUrl, cinUrl, resolveDirector } from "@/lib/collectors/indiafilings";

// ── Development probe ───────────────────────────────────────────────────────
// The repo has no test runner, and the parsers here read third-party HTML that
// changes without notice. This route makes each one individually checkable in a
// browser against the live page, which is the only check that means anything for
// a scraper — a fixture would only ever prove we can parse yesterday's markup.
//
// It ships disabled. Production returns 404, exactly as /print-preview does, so
// there is no new surface on a deployed instance.
//
//   /api/dev/probe?din=07013291
//   /api/dev/probe?cin=U72900DL2019PTC358371
//   /api/dev/probe?name=Manik+Mehta

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const params = new URL(req.url).searchParams;
  const started = Date.now();

  try {
    const din = params.get("din");
    if (din) return ok(await directorByDin(din), started);

    const cin = params.get("cin");
    if (cin) return ok(await companyByUrl(cinUrl(cin)), started);

    const name = params.get("name");
    if (name) return ok(await resolveDirector({ name, anchorCompany: params.get("company") ?? undefined }), started);

    return NextResponse.json(
      { usage: ["?din=07013291", "?cin=U72900DL2019PTC358371", "?name=Manik+Mehta&company=Saarthi+Techpro"] },
      { status: 400 },
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err), ms: Date.now() - started },
      { status: 502 },
    );
  }
}

function ok(data: unknown, started: number): NextResponse {
  return NextResponse.json({ ms: Date.now() - started, found: data !== null, data });
}
