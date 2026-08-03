// ── Which LLM provider to use, and in what order ───────────────────────────
// Single source of truth, shared by the Next app (via lib/collectors/env.ts)
// and scripts/llm-healthcheck.mjs, so the preflight check can never disagree
// with what the app actually does.
//
// Default: Claude via Amazon Bedrock first, OpenAI as an automatic fallback.
// Set LLM_PROVIDER=openai to put OpenAI back in front.

/** @typedef {"bedrock"|"openai"} LlmProvider */

/**
 * Providers to try, in order. An empty array means no key is configured, so
 * the caller should use the deterministic (rules-based) brief.
 * @param {Record<string, string|undefined>} [env]
 * @returns {LlmProvider[]}
 */
export function llmProviderChain(env = process.env) {
  /** @type {LlmProvider[]} */
  const available = [];
  // TEMP_CLAUDE_TOKEN is the older name for BEDROCK_API_KEY, still accepted.
  if (env.BEDROCK_API_KEY || env.TEMP_CLAUDE_TOKEN) available.push("bedrock");
  if (env.OPENAI_API_KEY) available.push("openai");

  const raw = String(env.LLM_PROVIDER || "").trim().toLowerCase();
  /** @type {LlmProvider|null} */
  const preferred =
    raw === "openai"
      ? "openai"
      : ["claude", "bedrock", "anthropic"].includes(raw)
        ? "bedrock"
        : null;

  if (!preferred) return available;
  return [...available.filter((p) => p === preferred), ...available.filter((p) => p !== preferred)];
}
