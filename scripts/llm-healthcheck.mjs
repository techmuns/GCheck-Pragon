// ── LLM preflight health check ─────────────────────────────────────────────
// Makes ONE cheap structured call and prints which provider and model
// answered. Run it before any expensive or metered work so a bad key costs a
// couple of seconds instead of a whole research run.
//
//   npm run healthcheck:llm
//
// Exit codes: 0 = a provider answered, 1 = every configured provider failed,
// 2 = nothing configured at all.
//
// Provider order comes from ../lib/llm-provider.mjs — the same rule the app
// uses — so this cannot drift from real behaviour.

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { callBedrockStructured, bedrockConfig, resetPinnedRoute } from "../lib/bedrock.mjs";
import { llmProviderChain } from "../lib/llm-provider.mjs";

// `next dev` reads .env.local automatically; a plain node script does not, so
// load it here too — otherwise a key that works in the app reports as "not
// configured" here. Real environment variables (CI secrets) always win, and
// missing files are ignored.
function loadDotEnvFiles() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

  for (const name of [".env.local", ".env"]) {
    const file = path.join(root, name);
    if (!existsSync(file)) continue;

    for (const line of readFileSync(file, "utf8").split("\n")) {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!match) continue;

      const [, key, rest] = match;
      if (process.env[key] !== undefined) continue;

      let value = rest.trim();
      const quote = value[0];
      if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length > 1) {
        value = value.slice(1, -1);
      } else {
        value = value.replace(/\s+#.*$/, "").trim(); // trailing comment
      }
      if (value) process.env[key] = value;
    }
  }
}

loadDotEnvFiles();

// Deliberately tiny: a handful of tokens in, a handful out.
const PING_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["ok"],
  properties: { ok: { type: "boolean" } },
};

const SYSTEM = "You are a health check. Reply only via the structured output.";
const USER = "Return ok = true.";

async function checkBedrock() {
  const config = bedrockConfig();
  resetPinnedRoute(); // Always exercise real discovery, never a warm pin.

  const { data, model, mode, usage } = await callBedrockStructured({
    system: SYSTEM,
    user: USER,
    toolName: "health_check",
    toolDescription: "Report health-check status.",
    schema: PING_SCHEMA,
    maxTokens: 64,
    config,
    onNote: (note) => console.log(`   … ${note}`),
  });

  return {
    provider: "bedrock",
    model,
    detail: `region=${config.region} structured=${mode}`,
    payload: data,
    usage,
  };
}

async function checkOpenAI() {
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  const completion = await client.chat.completions.create({
    model,
    max_tokens: 64,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: USER },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "health_check", strict: true, schema: PING_SCHEMA },
    },
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) throw new Error("Empty completion");

  return {
    provider: "openai",
    model,
    detail: "structured=json_schema",
    payload: JSON.parse(raw),
    usage: completion.usage,
  };
}

const RUNNERS = { bedrock: checkBedrock, openai: checkOpenAI };

async function main() {
  const chain = llmProviderChain();

  if (chain.length === 0) {
    console.error("✗ No LLM provider configured.");
    console.error("  Set BEDROCK_API_KEY (primary) and/or OPENAI_API_KEY (fallback).");
    process.exit(2);
  }

  console.log(`LLM preflight — provider order: ${chain.join(" → ")}`);

  const failures = [];

  for (const provider of chain) {
    console.log(`\n→ ${provider}`);
    try {
      const result = await RUNNERS[provider]();
      console.log(`\n✓ ${result.provider} answered — model: ${result.model}`);
      console.log(`  ${result.detail}`);
      console.log(`  payload: ${JSON.stringify(result.payload)}`);
      if (result.usage) console.log(`  usage: ${JSON.stringify(result.usage)}`);
      if (provider !== chain[0]) {
        console.log(`\n⚠  Primary provider (${chain[0]}) did not answer — running on the fallback.`);
      }
      process.exit(0);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`✗ ${provider} failed: ${message}`);
      failures.push(`${provider}: ${message}`);
    }
  }

  console.error("\n✗ Every configured provider failed:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

main().catch((err) => {
  console.error("✗ Health check crashed:", err);
  process.exit(1);
});
