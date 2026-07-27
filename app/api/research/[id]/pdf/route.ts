import { NextRequest, NextResponse } from "next/server";
import { getRun } from "@/lib/store";
import { launchBrowser } from "@/lib/collectors/browser";

export const dynamic = "force-dynamic";

/** A filesystem-friendly base name for the downloaded file (no extension). */
function fileName(company: string): string {
  const safe = (company || "").replace(/[^\p{L}\p{N}\-_. ]/gu, "").trim() || "Pre-Screen";
  return `Pre-Screen — ${safe}`;
}

// GET /api/research/:id/pdf — render the finished brief to a real PDF and hand
// it back as a direct download (no browser print dialog). Chromium — the same
// one the collectors run on — loads the print page (/print?id=…) under print
// media and exports it, so the file is byte-for-byte the on-screen one-page
// A4-landscape brief (components/BriefPrint), not a second layout.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const run = getRun(params.id);
  if (!run) {
    return NextResponse.json({ error: "Run not found." }, { status: 404 });
  }
  if (!run.brief) {
    return NextResponse.json({ error: "This run has no brief yet." }, { status: 409 });
  }

  // Drive our own server over loopback — avoids any external proxy/auth and
  // works the same in the all-in-one and hybrid (backend-serves-pages) deploys.
  const port = process.env.PORT ?? "3000";
  const target = `http://127.0.0.1:${port}/print?id=${encodeURIComponent(params.id)}`;

  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.emulateMedia({ media: "print" });
    await page.goto(target, { waitUntil: "networkidle", timeout: 30_000 });
    // The brief is client-fetched then portalled to <body>; wait for it to land.
    await page.waitForSelector(".pb-page", { state: "attached", timeout: 20_000 });

    const pdf = await page.pdf({
      printBackground: true,
      // Honour the document's own `@page { size: A4 landscape; margin: 0 }`.
      preferCSSPageSize: true,
      pageRanges: "1",
    });

    const name = `${fileName(run.subject.company)}.pdf`;
    const asciiName = name.replace(/[^\x20-\x7e]/g, "_");
    return new NextResponse(pdf, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not generate the PDF.";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    await browser.close();
  }
}
