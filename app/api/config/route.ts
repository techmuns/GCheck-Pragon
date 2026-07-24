import { NextRequest, NextResponse } from "next/server";
import { getConfig, saveConfig } from "@/lib/store";
import { defaultConfig } from "@/lib/config";
import type { AppConfig, BriefSection, Keyword, Source } from "@/lib/types";

export const dynamic = "force-dynamic";

// GET /api/config — current editable config.
export async function GET() {
  const config = await getConfig();
  return NextResponse.json(config);
}

// PUT /api/config — persist edited config. Validated + normalised before save;
// the next research run picks it up automatically.
export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid config payload." }, { status: 400 });
  }

  try {
    const clean = normalise(body as Partial<AppConfig>);
    await saveConfig(clean);
    return NextResponse.json(clean);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not save config." }, { status: 400 });
  }
}

// POST /api/config/reset is handled via a `?reset=1` flag for simplicity.
export async function POST(req: NextRequest) {
  if (req.nextUrl.searchParams.get("reset") === "1") {
    await saveConfig(defaultConfig);
    return NextResponse.json(defaultConfig);
  }
  return NextResponse.json({ error: "Unsupported." }, { status: 400 });
}

function normalise(input: Partial<AppConfig>): AppConfig {
  const base = defaultConfig;

  const sources: Source[] = Array.isArray(input.sources)
    ? input.sources.map((s, i) => ({
        id: String(s.id ?? base.sources[i]?.id ?? `src-${i}`),
        name: String(s.name ?? "Untitled source"),
        kind: s.kind === "browser" ? "browser" : "api",
        description: String(s.description ?? ""),
        enabled: Boolean(s.enabled),
        url: s.url ? String(s.url) : undefined,
        locked: Boolean(s.locked),
        lockReason: s.lockReason ? String(s.lockReason) : undefined,
      }))
    : base.sources;

  const keywords: Keyword[] = Array.isArray(input.keywords)
    ? input.keywords
        .map((k, i) => ({
          id: String(k.id ?? `kw-${i + 1}`),
          term: String(k.term ?? "").trim(),
          enabled: Boolean(k.enabled),
        }))
        .filter((k) => k.term.length > 0)
    : base.keywords;

  const sections: BriefSection[] = Array.isArray(input.sections)
    ? input.sections.map((s, i) => ({
        id: String(s.id ?? `sec-${i}`),
        title: String(s.title ?? "Untitled section").trim() || "Untitled section",
        hint: String(s.hint ?? ""),
        enabled: Boolean(s.enabled),
        order: Number.isFinite(s.order) ? Number(s.order) : i,
      }))
    : base.sections;

  // Re-index order to a clean 0..n by current array position.
  sections.forEach((s, i) => (s.order = i));

  const synthesisPrompt =
    typeof input.synthesisPrompt === "string" && input.synthesisPrompt.trim().length > 0
      ? input.synthesisPrompt
      : base.synthesisPrompt;

  return { sources, keywords, sections, synthesisPrompt };
}
