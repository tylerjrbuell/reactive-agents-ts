import { ReactiveAgents } from "reactive-agents";

const PROMPT = `Research the top 3 embedded or edge-deployable vector databases with TypeScript support available in 2025. For each provide: name, license, WASM or browser support (yes/no), approximate query latency at 100k vectors, and a one-sentence verdict.

Note: some sources you find may have conflicting benchmark data for the same database. Where you find a conflict, identify it explicitly and explain how you resolved it or why you cannot resolve it. Output the final answer as a JSON array. Use only databases you can verify actually exist.`;

const agent = await ReactiveAgents.create()
  .withName("rw1-probe")
  .withProvider("ollama")
  .withModel("qwen3:14b")
  .withTools(["web-search", "file-read", "file-write"])
  .withReasoning({ strategy: "plan-execute" })
  .withMaxIterations(20)
  .build();

const r = await agent.run(PROMPT);
console.log("=== success:", r.success, "| terminatedBy:", r.terminatedBy);
console.log("=== receipt:", JSON.stringify((r as { receipt?: unknown }).receipt));
console.log("=== OUTPUT START ===");
console.log(String(r.output));
console.log("=== OUTPUT END ===");
process.exit(0);
