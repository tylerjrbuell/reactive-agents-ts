/**
 * P7 — A2A dormancy live confirm: does .withA2A() actually expose the agent?
 */
import { ReactiveAgents } from "reactive-agents";

const agent: any = await ReactiveAgents.create()
  .withName("p7-a2a")
  .withProvider("ollama")
  .withModel("qwen3:4b")
  .withA2A({ port: 41888 })
  .build();

console.log("=== P7 A2A ===");
console.log("agent has start():", typeof agent.start);
if (typeof agent.start === "function") {
  try { await agent.start(); console.log("start() called ok"); } catch (e) { console.log("start() threw:", String(e).slice(0, 120)); }
}
await new Promise((r) => setTimeout(r, 1500));

for (const path of ["/.well-known/agent.json", "/"]) {
  try {
    const res = await fetch(`http://127.0.0.1:41888${path}`, { signal: AbortSignal.timeout(3000) });
    console.log(`GET ${path}: HTTP ${res.status}`, (await res.text()).slice(0, 120));
  } catch (e) {
    console.log(`GET ${path}: FAILED —`, String((e as Error).cause ?? e).slice(0, 80));
  }
}
if (typeof agent.stop === "function") await agent.stop().catch(() => {});
process.exit(0);
