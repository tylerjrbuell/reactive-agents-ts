/**
 * P2 — RunHandle process-model probe (live, ollama qwen3:4b)
 * What mid-run control does a developer actually have today?
 */
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withName("p2-runhandle")
  .withProvider("ollama")
  .withModel("qwen3:4b")
  .withTools(["calculator"])
  .withMaxIterations(8)
  .build();

const handle = agent.runStream(
  "Compute step by step using the calculator: (137*89), then add 4455 to it, then divide by 7. Show each step."
) as any;

console.log("=== P2 RUNHANDLE SURFACE ===");
console.log("handle keys:", Object.getOwnPropertyNames(handle).sort().join(", "));
console.log("has pause:", typeof handle.pause, "| resume:", typeof handle.resume, "| stop:", typeof handle.stop, "| terminate:", typeof handle.terminate, "| status:", typeof handle.status);
for (const k of ["inspect", "fork", "grant", "revoke", "state", "messages"]) {
  console.log(`${k}:`, typeof handle[k]);
}

let events = 0;
let paused = false;
let statusWhilePaused: unknown;

(async () => {
  await new Promise((r) => setTimeout(r, 2500));
  if (handle.pause) {
    await handle.pause();
    paused = true;
    statusWhilePaused = handle.status?.();
    console.log("[t+2.5s] paused. status():", JSON.stringify(statusWhilePaused));
    await new Promise((r) => setTimeout(r, 1500));
    await handle.resume?.();
    console.log("[t+4s] resumed. status():", JSON.stringify(handle.status?.()));
    await new Promise((r) => setTimeout(r, 1500));
    await handle.stop?.();
    console.log("[t+5.5s] stop() requested. status():", JSON.stringify(handle.status?.()));
  }
})();

const tags: Record<string, number> = {};
for await (const ev of handle) {
  events++;
  const t = (ev as any)._tag ?? "unknown";
  tags[t] = (tags[t] ?? 0) + 1;
  if (events > 400) break;
}
console.log("events:", events, "| paused-worked:", paused);
console.log("event tags:", JSON.stringify(tags));
console.log("final status():", JSON.stringify(handle.status?.()));
process.exit(0);
