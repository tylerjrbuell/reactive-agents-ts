/**
 * P1 — First-touch DX + result-surface inventory (live, ollama qwen3:4b)
 * Question: what does a developer actually get back from run() today?
 */
import { ReactiveAgents } from "reactive-agents";

const start = Date.now();

const agent = await ReactiveAgents.create()
  .withName("p1-first-touch")
  .withProvider("ollama")
  .withModel("qwen3:4b")
  .withTools(["calculator"])
  .withMaxIterations(5)
  .build();

const result = await agent.run(
  "Use the calculator tool to compute 137 * 89, then state the result."
);

console.log("=== P1 RESULT SURFACE ===");
console.log("elapsed_ms:", Date.now() - start);
console.log("top-level keys:", Object.keys(result).sort().join(", "));
console.log("success:", (result as any).success);
console.log("answer:", String((result as any).answer ?? (result as any).output ?? "").slice(0, 200));
console.log("--- trust/receipt surface ---");
for (const k of ["receipt", "trust", "trustVerdict", "grounded", "verification", "honesty"]) {
  console.log(`${k}:`, (result as any)[k] === undefined ? "UNDEFINED" : JSON.stringify((result as any)[k]).slice(0, 200));
}
console.log("--- debrief ---");
const d = (result as any).debrief;
console.log("debrief keys:", d ? Object.keys(d).join(", ") : "UNDEFINED");
if (d) console.log("debrief.outcome:", d.outcome, "| confidence:", d.confidence);
console.log("--- metadata/metrics ---");
const meta = (result as any).metadata ?? (result as any).metrics;
console.log("metadata keys:", meta ? Object.keys(meta).join(", ") : "UNDEFINED");
const toolsUsed = (result as any).toolsUsed ?? d?.toolsUsed;
console.log("toolsUsed:", JSON.stringify(toolsUsed)?.slice(0, 150));
process.exit(0);
