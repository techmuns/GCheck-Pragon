import { callBedrockStructured, hasBedrock, pinnedRoute } from "./bedrock.mjs";

// ── Claude via Amazon Bedrock — transport adapter ──────────────────────────
// The primary provider for the Red-Flag Summary. This file is deliberately
// thin: it takes the prompt lib/synthesize.ts already built, sends it, and
// hands the parsed payload straight back.
//
// It holds NO prompt text and NO validation. Both live in lib/synthesize.ts
// and are shared with the OpenAI path, so improving the prompt improves both
// providers at once — the two cannot drift apart.
//
// The wire details (endpoint, x-api-key bearer auth, model fallback chain,
// json_schema vs forced-tool-use, SSE streaming) are in lib/bedrock.mjs.

export interface SummaryRequest {
  system: string;
  user: string;
  schema: Record<string, unknown>;
}

export interface SummaryResponse {
  headline: string;
  findings: Array<{ severity: string; text: string; sourceRef?: number | null }>;
}

export function hasClaudeBedrock(): boolean {
  return hasBedrock();
}

/** Which model + structured mode answered last, for logging / health checks. */
export function claudeRoute(): { model: string | null; mode: string | null } {
  return pinnedRoute();
}

/** Send an already-built summary prompt to Claude. Throws on any failure so
 *  lib/synthesize.ts can fall through to the next provider. */
export async function requestSummaryFromClaude({
  system,
  user,
  schema,
}: SummaryRequest): Promise<SummaryResponse> {
  const { data, model, mode } = await callBedrockStructured<SummaryResponse>({
    system,
    user,
    toolName: "red_flag_summary",
    toolDescription: "Return the red-flag summary headline and findings.",
    schema,
    // The summary is a headline plus a handful of one-sentence findings.
    maxTokens: 4096,
    onNote: (note) => console.warn("[synthesize-bedrock]", note),
  });

  console.log(`[synthesize-bedrock] answered by ${model} (${mode})`);

  return data ?? { headline: "", findings: [] };
}
