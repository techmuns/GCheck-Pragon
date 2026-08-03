// ── Offline tests for the Bedrock transport ────────────────────────────────
// Runs lib/bedrock.mjs against a local stub server that speaks the Bedrock
// Messages API wire format. No network, no credentials, no cost.
//
//   npm run test:llm
//
// Covers the failure modes that actually bite in this integration:
//   1. Happy path, output_config.format json_schema, streamed as text_delta
//   2. 403 on Opus 5 → falls through the model chain to Opus 4.8
//   3. output_config rejected with "Extra inputs are not permitted" → falls
//      back to forced tool use, streamed as input_json_delta
//   4. Route pinning — the second call goes straight to the working combo
//   5. Auth/HTTP errors surface (so synthesize.ts can fall through to OpenAI)
//   6. Request hygiene: x-api-key (not Authorization), anthropic-version,
//      anthropic. model prefix, and NO sampling params
//   7. Truncated JSON (stop_reason max_tokens) reports a useful message
//   8. Provider chain ordering from lib/llm-provider.mjs

import { createServer } from "node:http";
import assert from "node:assert/strict";
import {
  callBedrockStructured,
  bedrockConfig,
  pinnedRoute,
  resetPinnedRoute,
  BedrockError,
} from "../lib/bedrock.mjs";
import { llmProviderChain } from "../lib/llm-provider.mjs";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "findings"],
  properties: {
    headline: { type: "string" },
    findings: { type: "array", items: { type: "string" } },
  },
};

const PAYLOAD = { headline: "All clear", findings: ["nothing material"] };

// ── Stub server ────────────────────────────────────────────────────────────
// `behaviour` is swapped per test; `requests` records what the transport sent.

let behaviour = () => ({ kind: "json_schema_ok" });
const requests = [];

function sse(res, events) {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
  });
  for (const e of events) {
    // Deliberately CRLF — real SSE streams use it and the parser must cope.
    res.write(`event: ${e.type}\r\ndata: ${JSON.stringify(e)}\r\n\r\n`);
  }
  res.end();
}

/** Split a string into chunks so deltas arrive in pieces, like a real stream. */
function chunks(str, size = 7) {
  const out = [];
  for (let i = 0; i < str.length; i += size) out.push(str.slice(i, i + size));
  return out;
}

function textDeltaEvents(payload, stopReason = "end_turn") {
  return [
    { type: "message_start", message: { usage: { input_tokens: 11 } } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    ...chunks(JSON.stringify(payload)).map((text) => ({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text },
    })),
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: stopReason }, usage: { output_tokens: 22 } },
    { type: "message_stop" },
  ];
}

function toolDeltaEvents(payload) {
  return [
    { type: "message_start", message: { usage: { input_tokens: 13 } } },
    {
      type: "content_block_start",
      index: 0,
      content_block: { type: "tool_use", id: "toolu_stub", name: "red_flag_summary", input: {} },
    },
    // Tool payloads stream as input_json_delta, never text_delta.
    ...chunks(JSON.stringify(payload)).map((partial_json) => ({
      type: "content_block_delta",
      index: 0,
      delta: { type: "input_json_delta", partial_json },
    })),
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 25 } },
    { type: "message_stop" },
  ];
}

const server = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const body = JSON.parse(raw);
    const record = { url: req.url, headers: req.headers, body };
    requests.push(record);

    const action = behaviour(record);

    switch (action.kind) {
      case "json_schema_ok":
        return sse(res, textDeltaEvents(action.payload ?? PAYLOAD));
      case "tool_ok":
        return sse(res, toolDeltaEvents(action.payload ?? PAYLOAD));
      case "truncated":
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(
          `data: ${JSON.stringify({
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: '{"headline":"cut o' },
          })}\n\n`,
        );
        res.write(
          `data: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "max_tokens" } })}\n\n`,
        );
        return res.end();
      case "status":
        res.writeHead(action.status, { "content-type": "application/json" });
        return res.end(JSON.stringify(action.body));
      default:
        throw new Error(`unknown stub behaviour: ${action.kind}`);
    }
  });
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();

const CONFIG = {
  ...bedrockConfig({
    BEDROCK_API_KEY: "stub-key",
    BEDROCK_REGION: "us-east-1",
  }),
  baseUrl: `http://127.0.0.1:${port}/anthropic`,
};

function call(overrides = {}) {
  return callBedrockStructured({
    system: "system prompt",
    user: "user prompt",
    toolName: "red_flag_summary",
    schema: SCHEMA,
    config: CONFIG,
    onNote: () => {},
    ...overrides,
  });
}

function reset(fn) {
  requests.length = 0;
  resetPinnedRoute();
  behaviour = fn;
}

// ── Tests ──────────────────────────────────────────────────────────────────

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("1. json_schema happy path streams text_delta into a parsed object", async () => {
  reset(() => ({ kind: "json_schema_ok" }));
  const result = await call();

  assert.deepEqual(result.data, PAYLOAD);
  assert.equal(result.model, "anthropic.claude-opus-5");
  assert.equal(result.mode, "json_schema");
  assert.equal(result.stopReason, "end_turn");
  assert.equal(result.usage.output_tokens, 22);
  assert.equal(requests.length, 1);
});

test("2. 403 on Opus 5 falls through the model chain to Opus 4.8", async () => {
  reset((req) =>
    req.body.model === "anthropic.claude-opus-5"
      ? { kind: "status", status: 403, body: { message: "no access to this model" } }
      : { kind: "json_schema_ok" },
  );

  const result = await call();

  assert.equal(result.model, "anthropic.claude-opus-4-8");
  assert.equal(result.mode, "json_schema");
  assert.deepEqual(
    requests.map((r) => r.body.model),
    ["anthropic.claude-opus-5", "anthropic.claude-opus-4-8"],
  );
});

test("3. output_config rejection falls back to forced tool use (input_json_delta)", async () => {
  reset((req) =>
    req.body.output_config
      ? {
          kind: "status",
          status: 400,
          body: { error: { message: "output_config.format: Extra inputs are not permitted" } },
        }
      : { kind: "tool_ok" },
  );

  const result = await call();

  assert.equal(result.mode, "tool");
  assert.deepEqual(result.data, PAYLOAD);
  assert.equal(result.model, "anthropic.claude-opus-5");

  // The retry must be forced single-tool use carrying the same schema.
  const toolReq = requests.at(-1).body;
  assert.equal(toolReq.tools.length, 1);
  assert.equal(toolReq.tools[0].name, "red_flag_summary");
  assert.deepEqual(toolReq.tools[0].input_schema, SCHEMA);
  assert.deepEqual(toolReq.tool_choice, { type: "tool", name: "red_flag_summary" });
  assert.equal(toolReq.output_config, undefined);
});

test("4. the working model+mode is pinned for later calls", async () => {
  reset((req) => {
    if (req.body.model === "anthropic.claude-opus-5") {
      return { kind: "status", status: 403, body: { message: "no access" } };
    }
    return req.body.output_config
      ? { kind: "status", status: 400, body: { error: { message: "Extra inputs are not permitted" } } }
      : { kind: "tool_ok" };
  });

  const first = await call();
  assert.equal(first.model, "anthropic.claude-opus-4-8");
  assert.equal(first.mode, "tool");
  const discoveryRequests = requests.length;
  assert.ok(discoveryRequests > 1, "discovery should cost more than one request");
  assert.deepEqual(pinnedRoute(), { model: "anthropic.claude-opus-4-8", mode: "tool" });

  requests.length = 0;
  const second = await call(); // Pin must survive — do NOT reset it here.

  assert.equal(second.model, "anthropic.claude-opus-4-8");
  assert.equal(second.mode, "tool");
  assert.equal(requests.length, 1, "a pinned route should be one request");
});

test("5. auth and server errors propagate so OpenAI fallback can take over", async () => {
  reset(() => ({ kind: "status", status: 401, body: { message: "bad key" } }));
  await assert.rejects(call(), (err) => err instanceof BedrockError && err.kind === "auth");

  reset(() => ({ kind: "status", status: 500, body: { message: "boom" } }));
  await assert.rejects(call(), (err) => err instanceof BedrockError && err.kind === "http");

  resetPinnedRoute();
  await assert.rejects(
    callBedrockStructured({
      system: "s",
      user: "u",
      toolName: "t",
      schema: SCHEMA,
      config: { ...CONFIG, apiKey: "" },
    }),
    (err) => err instanceof BedrockError && err.kind === "auth",
  );
});

test("6. request hygiene: x-api-key, version header, model prefix, no sampling params", async () => {
  reset(() => ({ kind: "json_schema_ok" }));
  await call();

  const { headers, body, url } = requests[0];

  assert.equal(url, "/anthropic/v1/messages");
  assert.equal(headers["x-api-key"], "stub-key");
  assert.equal(headers.authorization, undefined, "must not use the Authorization header");
  assert.equal(headers["anthropic-version"], "2023-06-01");

  assert.ok(body.model.startsWith("anthropic."), "Bedrock model IDs carry the anthropic. prefix");
  assert.equal(body.stream, true);
  assert.equal(body.system, "system prompt");
  assert.deepEqual(body.messages, [{ role: "user", content: "user prompt" }]);

  // Sampling params are rejected with a 400 on Opus 5 / 4.8 / 4.7.
  for (const param of ["temperature", "top_p", "top_k"]) {
    assert.equal(body[param], undefined, `${param} must never be sent`);
  }
});

test("7. truncated JSON reports the max_tokens cause", async () => {
  reset(() => ({ kind: "truncated" }));
  await assert.rejects(call(), (err) => {
    assert.ok(err instanceof BedrockError);
    assert.match(err.message, /max_tokens/);
    return true;
  });
});

test("8. provider chain: Bedrock leads, LLM_PROVIDER=openai flips it", async () => {
  assert.deepEqual(llmProviderChain({ BEDROCK_API_KEY: "k", OPENAI_API_KEY: "o" }), [
    "bedrock",
    "openai",
  ]);
  assert.deepEqual(
    llmProviderChain({ BEDROCK_API_KEY: "k", OPENAI_API_KEY: "o", LLM_PROVIDER: "openai" }),
    ["openai", "bedrock"],
  );
  // The legacy key name still selects Bedrock.
  assert.deepEqual(llmProviderChain({ TEMP_CLAUDE_TOKEN: "k" }), ["bedrock"]);
  assert.deepEqual(llmProviderChain({ OPENAI_API_KEY: "o" }), ["openai"]);
  assert.deepEqual(llmProviderChain({}), []);
});

// ── Runner ─────────────────────────────────────────────────────────────────

let failed = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`✗ ${name}\n  ${err && err.stack ? err.stack : err}`);
  }
}

server.close();
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
