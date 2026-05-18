/**
 * Tool Integration -- built-in tools demo
 *
 * The agent uses built-in tools to:
 *   1. Write reasoning notes to the scratchpad
 *   2. Execute a small JS snippet to compute a result
 *   3. Synthesize a final answer
 *
 * No extra API keys required beyond the LLM provider.
 * Built-in tools run inside the WebContainer sandbox.
 *
 * Secrets to add in Stackblitz (Settings icon, left sidebar):
 *   GOOGLE_API_KEY     -> ai.google.dev  (recommended, free tier)
 *   ANTHROPIC_API_KEY  -> console.anthropic.com
 *   OPENAI_API_KEY     -> platform.openai.com
 *
 *   Or local Ollama via an HTTPS tunnel (WebContainer localhost is NOT
 *   your machine — bare localhost only works on a local clone):
 *   PROVIDER=ollama  OLLAMA_ENDPOINT=https://YOUR-TUNNEL.trycloudflare.com
 *   (OLLAMA_ORIGINS=* ollama serve + cloudflared tunnel --url http://localhost:11434)
 */

import { ReactiveAgents } from "reactive-agents";

type PN = "gemini" | "anthropic" | "openai" | "ollama";

const provider = (process.env.PROVIDER ?? "gemini") as PN;

// Treat empty / unedited placeholder values as "no key" so the user gets
// the friendly setup message instead of a provider 400.
const realKey = (v?: string) =>
  !!v && v.trim().length > 0 && !/^your_|_here$|^<.*>$/i.test(v.trim());

const hasKey =
  realKey(process.env.GOOGLE_API_KEY) ||
  realKey(process.env.ANTHROPIC_API_KEY) ||
  realKey(process.env.OPENAI_API_KEY) ||
  provider === "ollama";

if (!hasKey) {
  console.log(`
================================================
  No API key found. Add one in Stackblitz Secrets:

  GOOGLE_API_KEY     -> ai.google.dev   (free tier, recommended)
  ANTHROPIC_API_KEY  -> console.anthropic.com
  OPENAI_API_KEY     -> platform.openai.com

  Local Ollama (Chrome) needs an HTTPS tunnel — WebContainer localhost
  is NOT your machine. See the playground guide for the full recipe:
    OLLAMA_ORIGINS=* ollama serve
    cloudflared tunnel --url http://localhost:11434
    PROVIDER=ollama  OLLAMA_ENDPOINT=https://YOUR-TUNNEL.trycloudflare.com
================================================
`);
  process.exit(0);
}

const ollamaEndpoint =
  process.env.OLLAMA_BRIDGE_EXTENSION
    ? "reactive-agents://ollama-bridge"
    : (process.env.OLLAMA_ENDPOINT ?? "http://localhost:11434");

const model =
  process.env.MODEL ??
  (provider === "gemini"
    ? "gemini-2.0-flash"
    : provider === "ollama"
      ? "llama3.2"
      : undefined);

const agent = await ReactiveAgents.create()
  .withName("tool-integration-demo")
  .withProvider(provider)
  .withModel(model ?? "")
  .withTools()                                        // enables: file-read, file-write, code-execute, scratchpad-write, scratchpad-read
  .withReasoning({ defaultStrategy: "reactive" })     // ReAct loop: think -> use tool -> observe -> repeat
  .withMaxIterations(8)
  .build();

const task =
  process.env.TASK ??
  "Calculate the sum of the first 10 Fibonacci numbers using the code-execute tool, then write a brief explanation to the scratchpad.";

console.log(`\nProvider: ${provider}${model ? ` (${model})` : ""}`);
console.log(`Task: ${task}\n`);
console.log("Running agent with built-in tools...\n");
console.log("(Watch the terminal -- you'll see each tool call as it happens)\n");

const result = await agent.run(task);

console.log("--- Final Answer ---");
console.log(result.output);
console.log("\n--- Stats ---");
console.log(`Steps:    ${result.metadata.stepsCount}`);
console.log(`Tokens:   ${result.metadata.tokensUsed}`);
console.log(`Cost:     $${result.metadata.cost.toFixed(6)}`);
console.log(`Duration: ${result.metadata.duration}ms`);
console.log(`\nTry changing TASK in Secrets to give the agent a different challenge!`);
