/**
 * Hello Agent -- simplest Reactive Agents demo
 *
 * Runs a single Q&A query and prints the result.
 *
 * Secrets to add in Stackblitz (Settings icon, left sidebar):
 *   GOOGLE_API_KEY     -> ai.google.dev  (recommended, free tier)
 *   ANTHROPIC_API_KEY  -> console.anthropic.com
 *   OPENAI_API_KEY     -> platform.openai.com
 *
 *   Or use local Ollama:
 *   PROVIDER=ollama
 *   OLLAMA_ENDPOINT=http://localhost:11434
 *   (requires: OLLAMA_ORIGINS=* on your Ollama server)
 */

import { ReactiveAgents } from "reactive-agents";

type PN = "gemini" | "anthropic" | "openai" | "ollama";

const provider = (process.env.PROVIDER ?? "gemini") as PN;

const hasKey =
  Boolean(process.env.GOOGLE_API_KEY) ||
  Boolean(process.env.ANTHROPIC_API_KEY) ||
  Boolean(process.env.OPENAI_API_KEY) ||
  provider === "ollama";

if (!hasKey) {
  console.log(`
================================================
  No API key found. Add one in Stackblitz Secrets:

  GOOGLE_API_KEY     -> ai.google.dev   (free tier, recommended)
  ANTHROPIC_API_KEY  -> console.anthropic.com
  OPENAI_API_KEY     -> platform.openai.com

  For local Ollama (Chrome only):
    PROVIDER          = ollama
    OLLAMA_ENDPOINT   = http://localhost:11434
    (run: OLLAMA_ORIGINS=* ollama serve)
================================================
`);
  process.exit(0);
}

// v0.12 hook: Chrome extension can bridge localhost Ollama via postMessage
const ollamaEndpoint =
  process.env.OLLAMA_BRIDGE_EXTENSION
    ? "reactive-agents://ollama-bridge"
    : (process.env.OLLAMA_ENDPOINT ?? "http://localhost:11434");

const model =
  process.env.MODEL ??
  (provider === "gemini"
    ? "gemini-1.5-flash"
    : provider === "ollama"
      ? "llama3.2"
      : undefined);

const agent = await ReactiveAgents.create()
  .withName("hello-agent")
  .withProvider(provider)
  .withModel(model ?? "")
  .withMaxIterations(3)
  .build();

const question =
  process.env.QUESTION ??
  "What are three practical use cases for AI agents in software development?";

console.log(`\nProvider: ${provider}${model ? ` (${model})` : ""}`);
console.log(`Question: ${question}\n`);
console.log("Running...\n");

const result = await agent.run(question);

console.log("--- Answer ---");
console.log(result.output);
console.log("\n--- Stats ---");
console.log(`Steps:    ${result.metadata.stepsCount}`);
console.log(`Tokens:   ${result.metadata.tokensUsed}`);
console.log(`Cost:     $${result.metadata.cost.toFixed(6)}`);
console.log(`Duration: ${result.metadata.duration}ms`);
console.log(`\nDone. Try changing QUESTION in Secrets to ask anything!`);
