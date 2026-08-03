// Type surface for ./llm-provider.mjs.

export type LlmProvider = "bedrock" | "openai";

export declare function llmProviderChain(
  env?: Record<string, string | undefined>,
): LlmProvider[];
