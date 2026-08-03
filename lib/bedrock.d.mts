// Type surface for ./bedrock.mjs — see that file for behaviour.

export type BedrockErrorKind =
  | "model_unavailable"
  | "mode_unsupported"
  | "auth"
  | "stream"
  | "http";

export type StructuredMode = "json_schema" | "tool";

export declare class BedrockError extends Error {
  kind: BedrockErrorKind;
  status?: number;
  constructor(message: string, kind: BedrockErrorKind, status?: number);
}

export interface BedrockConfig {
  apiKey: string;
  region: string;
  baseUrl: string;
  models: string[];
}

export interface BedrockUsage {
  input_tokens?: number;
  output_tokens?: number;
  [key: string]: unknown;
}

export interface StructuredResult<T = unknown> {
  data: T;
  model: string;
  mode: StructuredMode;
  stopReason: string | null;
  usage: BedrockUsage | null;
}

export interface CallBedrockStructuredOptions {
  system: string;
  user: string;
  toolName: string;
  toolDescription?: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
  config?: BedrockConfig;
  fetchImpl?: typeof fetch;
  onNote?: (note: string) => void;
}

export declare function bedrockConfig(env?: NodeJS.ProcessEnv): BedrockConfig;
export declare function hasBedrock(env?: NodeJS.ProcessEnv): boolean;
export declare function pinnedRoute(): { model: string | null; mode: StructuredMode | null };
export declare function resetPinnedRoute(): void;
export declare function callBedrockStructured<T = unknown>(
  options: CallBedrockStructuredOptions,
): Promise<StructuredResult<T>>;
