import { NextRequest, NextResponse } from "next/server";
import { getRun } from "@/lib/store";
import { briefReportHtml, reportFileName } from "@/lib/report";
import { launchBrowser } from "@/lib/collectors/browser";

export const dynamic = "force-dynamic";

// GET /api/research/:id/pdf — render the finished brief to a real PDF and hand
// it back as a direct download. The client just navigates here; no browser
// print dialog is involved. Reuses the same Playwright/Chromium the collectors
// run on, driving `page.pdf()` over the standalone report HTML (lib/report.ts).
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const run = getRun(params.id);
  if (!run) {
    return NextResponse.json({ error: "Run not found." }, { status: 404 });
  }
  if (!run.brief) {
    return NextResponse.json({ error: "This run has no brief yet." }, { status: 409 });
  }

  const html = briefReportHtml(run);

  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "14mm", bottom: "14mm", left: "14mm", right: "14mm" },
    });

    const filename = `${reportFileName(run)}.pdf`;
    // RFC 5987 encoding so non-ASCII subject names survive the header.
    const asciiName = filename.replace(/[^\x20-\x7e]/g, "_");
    return new NextResponse(pdf, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
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
