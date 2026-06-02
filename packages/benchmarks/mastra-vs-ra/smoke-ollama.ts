// Smoke test: same task → Reactive Agents vs Mastra → Ollama (qwen3.5:latest)
// Uses Mastra v1.36 current API (.generate() + ollama-ai-provider-v2 / AI SDK v5).

import "dotenv/config";
import { ReactiveAgents } from "reactive-agents";
import { Agent } from "@mastra/core/agent";
import { createOllama } from "ollama-ai-provider-v2";

const TASK = "What is the capital city of France? Give just the city name.";
const MODEL = "qwen3.5:latest";

async function runReactiveAgents() {
  const t0 = Date.now();
  const agent = await ReactiveAgents.create()
    .withName("ra-smoke")
    .withProvider("ollama")
    .withModel({ model: MODEL })
    .withReasoning({ defaultStrategy: "reactive", maxIterations: 3 })
    .build();
  const result = await agent.run(TASK);
  await agent.dispose();
  return {
    framework: "reactive-agents",
    durationMs: Date.now() - t0,
    output: result.output ?? "",
    tokens: result.metadata?.tokensUsed ?? 0,
    success: typeof result.output === "string" && result.output.toLowerCase().includes("paris"),
  };
}

async function runMastra() {
  const t0 = Date.now();
  const ollama = createOllama();
  const agent = new Agent({
    name: "mastra-smoke",
    instructions: "Answer concisely.",
    model: ollama(MODEL),
  });
  const result = await agent.generate(TASK);
  const usage = (result as unknown as { usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number } }).usage;
  const tokens = usage?.totalTokens ?? (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0);
  return {
    framework: "mastra",
    durationMs: Date.now() - t0,
    output: result.text ?? "",
    tokens,
    success: typeof result.text === "string" && result.text.toLowerCase().includes("paris"),
  };
}

async function main() {
  console.log(`Task: ${TASK}`);
  console.log(`Model: ${MODEL}\n`);

  for (const runner of [runReactiveAgents, runMastra]) {
    try {
      const r = await runner();
      console.log(`[${r.framework}]`);
      console.log(`  success:   ${r.success}`);
      console.log(`  duration:  ${(r.durationMs / 1000).toFixed(2)}s`);
      console.log(`  tokens:    ${r.tokens}`);
      console.log(`  output:    ${r.output.slice(0, 200).replace(/\n/g, " ")}\n`);
    } catch (err) {
      console.error(`[${runner.name}] ERROR:`, err instanceof Error ? err.message : String(err));
    }
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
