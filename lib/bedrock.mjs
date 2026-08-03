// ── Claude via Amazon Bedrock — transport only ─────────────────────────────
// One structured, streamed Messages-API call against the Bedrock endpoint.
// This file knows nothing about briefs, findings or severities — callers hand
// it a system prompt, a user prompt and a JSON schema, and get back a parsed
// object plus which model and structured-output mode actually answered.
//
// Plain .mjs (not .ts) so both the Next app and scripts/llm-healthcheck.mjs
// can import it without a build step. Types live in ./bedrock.d.mts.
//
// Endpoint       https://bedrock-mantle.{region}.api.aws/anthropic/v1/messages
// Auth           the Bedrock API key as a bearer token in the `x-api-key`
//                header — NOT `Authorization`, and no SigV4 / AWS SDK.
// Version        anthropic-version: 2023-06-01
//
// Three things this deliberately does:
//   1. Never sends temperature / top_p / top_k. Sampling params are rejected
//      with a 400 on Opus 5 / 4.8 / 4.7.
//   2. Walks a model fallback chain. Bedrock grants Opus 5 access per-account,
//      so a 403 on the first model is expected, not fatal.
//   3. Tries output_config.format json_schema first and falls back to forced
//      tool use, because some deployments reject output_config with
//      "Extra inputs are not permitted". Whichever works is pinned.

const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_REGION = "us-east-1";

// Opus 5 first, then the two models Bedrock opens to all accounts.
const DEFAULT_MODEL_CHAIN = [
  "anthropic.claude-opus-5",
  "anthropic.claude-opus-4-8",
  "anthropic.claude-sonnet-5",
];

// Preference order for getting structured JSON back.
const STRUCTURED_MODES = ["json_schema", "tool"];

export class BedrockError extends Error {
  /**
   * @param {string} message
   * @param {"model_unavailable"|"mode_unsupported"|"auth"|"stream"|"http"} kind
   * @param {number} [status]
   */
  constructor(message, kind, status) {
    super(message);
    this.name = "BedrockError";
    this.kind = kind;
    this.status = status;
  }
}

/** Read Bedrock settings out of the environment. */
export function bedrockConfig(env = process.env) {
  const region = env.BEDROCK_REGION || env.CLAUDE_BEDROCK_REGION || DEFAULT_REGION;
  const configured = String(env.BEDROCK_MODEL_IDS || env.BEDROCK_MODEL_ID || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    // BEDROCK_API_KEY is the name to use. TEMP_CLAUDE_TOKEN is the older name
    // this repo shipped with — still honoured so existing deploys don't break.
    apiKey: env.BEDROCK_API_KEY || env.TEMP_CLAUDE_TOKEN || "",
    region,
    // BEDROCK_BASE_URL exists so tests can point at a local stub server.
    baseUrl: env.BEDROCK_BASE_URL || `https://bedrock-mantle.${region}.api.aws/anthropic`,
    models: configured.length ? configured : DEFAULT_MODEL_CHAIN,
  };
}

export function hasBedrock(env = process.env) {
  return Boolean(bedrockConfig(env).apiKey);
}

// ── Route pinning ──────────────────────────────────────────────────────────
// Discovering the working model + mode costs up to a few rejected requests.
// Once a combination answers, pin it for the life of the process so every
// later call goes straight there.

let pinned = { model: null, mode: null };

export function pinnedRoute() {
  return { ...pinned };
}

export function resetPinnedRoute() {
  pinned = { model: null, mode: null };
}

/** Put the pinned entry first, keep the rest as tie-breakers. */
function ordered(all, first) {
  if (!first || !all.includes(first)) return all;
  return [first, ...all.filter((x) => x !== first)];
}

/**
 * Make one structured call, walking the model chain and the structured-output
 * modes until something answers. Resolves with the parsed object.
 */
export async function callBedrockStructured({
  system,
  user,
  toolName,
  toolDescription = "Return the structured result.",
  schema,
  maxTokens = 2048,
  config = bedrockConfig(),
  fetchImpl = fetch,
  onNote = () => {},
}) {
  if (!config.apiKey) {
    throw new BedrockError("No Bedrock API key (set BEDROCK_API_KEY).", "auth");
  }

  const models = ordered(config.models, pinned.model);
  const modes = ordered(STRUCTURED_MODES, pinned.mode);

  let lastError;

  for (const model of models) {
    let modelUnavailable = false;

    for (const mode of modes) {
      try {
        const result = await streamStructuredOnce({
          model,
          mode,
          system,
          user,
          toolName,
          toolDescription,
          schema,
          maxTokens,
          config,
          fetchImpl,
        });
        pinned = { model, mode };
        return { ...result, model, mode };
      } catch (err) {
        lastError = err;
        if (!(err instanceof BedrockError)) throw err;

        if (err.kind === "model_unavailable") {
          // Expected for Opus 5 on accounts without access — try the next model.
          onNote(`${model}: ${err.message} — trying next model`);
          modelUnavailable = true;
          break;
        }
        if (err.kind === "mode_unsupported") {
          onNote(`${model}: ${mode} rejected (${err.message}) — trying next mode`);
          continue;
        }
        throw err; // A real failure. Let the caller fall back to OpenAI.
      }
    }

    if (!modelUnavailable) break; // Model was reachable; modes are the problem.
  }

  throw lastError ?? new BedrockError("No Bedrock model answered.", "http");
}

function buildBody({ model, mode, system, user, toolName, toolDescription, schema, maxTokens }) {
  const body = {
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }],
    stream: true,
    // No temperature / top_p / top_k — 400 on Opus 5 / 4.8 / 4.7.
  };

  if (mode === "json_schema") {
    body.output_config = { format: { type: "json_schema", schema } };
  } else {
    body.tools = [{ name: toolName, description: toolDescription, input_schema: schema }];
    body.tool_choice = { type: "tool", name: toolName };
  }

  return body;
}

async function streamStructuredOnce({ model, mode, config, fetchImpl, ...rest }) {
  const res = await fetchImpl(`${config.baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // Bearer token goes here, not in Authorization.
      "x-api-key": config.apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      accept: "text/event-stream",
    },
    body: JSON.stringify(buildBody({ model, mode, ...rest })),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw classifyHttpError(res.status, detail, mode);
  }
  if (!res.body) {
    throw new BedrockError("Bedrock returned no response body.", "stream", res.status);
  }

  return readStructuredStream(res.body, mode);
}

function classifyHttpError(status, detail, mode) {
  const text = detail.slice(0, 600);

  // 403 = model not granted on this account, 404 = unknown model id.
  if (status === 403 || status === 404) {
    return new BedrockError(`HTTP ${status} ${text}`, "model_unavailable", status);
  }

  // The deployment rejects output_config — fall back to forced tool use.
  if (
    status === 400 &&
    mode === "json_schema" &&
    /output_config|Extra inputs are not permitted|json_schema/i.test(detail)
  ) {
    return new BedrockError(`HTTP 400 ${text}`, "mode_unsupported", status);
  }

  if (status === 401) {
    return new BedrockError(`HTTP 401 ${text}`, "auth", status);
  }

  return new BedrockError(`HTTP ${status} ${text}`, "http", status);
}

// ── SSE parsing ────────────────────────────────────────────────────────────
// json_schema mode streams the payload as text_delta; forced tool use streams
// it as input_json_delta on a tool_use block. Both accumulate to one JSON doc.

async function readStructuredStream(body, mode) {
  const reader = body.getReader();
  const decoder = new TextDecoder();

  let buffer = "";
  let text = "";
  let toolJson = "";
  let sawToolUse = false;
  let stopReason = null;
  let usage = null;
  let streamError = null;

  const handle = (payload) => {
    let event;
    try {
      event = JSON.parse(payload);
    } catch {
      return; // Ignore keep-alives and anything unparseable.
    }

    switch (event.type) {
      case "message_start":
        if (event.message?.usage) usage = event.message.usage;
        break;
      case "content_block_start":
        if (event.content_block?.type === "tool_use") sawToolUse = true;
        break;
      case "content_block_delta":
        if (event.delta?.type === "text_delta") text += event.delta.text ?? "";
        else if (event.delta?.type === "input_json_delta") toolJson += event.delta.partial_json ?? "";
        break;
      case "message_delta":
        if (event.delta?.stop_reason) stopReason = event.delta.stop_reason;
        if (event.usage) usage = { ...(usage ?? {}), ...event.usage };
        break;
      case "error":
        streamError = event.error ?? { message: "unknown stream error" };
        break;
      default:
        break;
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");

    let split;
    while ((split = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      for (const line of frame.split("\n")) {
        if (line.startsWith("data:")) handle(line.slice(5).trim());
      }
    }
  }

  if (streamError) {
    throw new BedrockError(`Stream error: ${streamError.message ?? JSON.stringify(streamError)}`, "stream");
  }
  if (stopReason === "refusal") {
    throw new BedrockError("Model refused the request (stop_reason: refusal).", "stream");
  }
  if (mode === "tool" && !sawToolUse) {
    throw new BedrockError("Forced tool use returned no tool_use block.", "stream");
  }

  const raw = (mode === "tool" ? toolJson : text).trim();
  if (!raw) {
    throw new BedrockError(`Empty structured payload (stop_reason: ${stopReason ?? "none"}).`, "stream");
  }

  try {
    return { data: JSON.parse(raw), stopReason, usage };
  } catch {
    const hint =
      stopReason === "max_tokens"
        ? " — hit max_tokens, so the JSON is truncated; raise maxTokens."
        : "";
    throw new BedrockError(`Structured payload was not valid JSON${hint}`, "stream");
  }
}
