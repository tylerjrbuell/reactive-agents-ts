/**
 * P3 — Durable rail + fork-substrate probe (live, ollama qwen3:4b)
 * Do checkpoints actually land in SQLite? Can we resume? What would fork() build on?
 */
import { ReactiveAgents } from "reactive-agents";
import { Database } from "bun:sqlite";
import { rmSync } from "node:fs";

const DB = "/tmp/claude-1000/p3-durable.db";
try { rmSync(DB); } catch {}

const agent = await ReactiveAgents.create()
  .withName("p3-durable")
  .withProvider("ollama")
  .withModel("qwen3:4b")
  .withTools(["calculator"])
  .withDurableRuns({ dbPath: DB, checkpointEvery: 1 })
  .withMaxIterations(6)
  .build();

const result: any = await agent.run(
  "Use the calculator: compute 44*17, then multiply that by 3. Give the final number."
);
console.log("=== P3 DURABLE ===");
console.log("success:", result.success, "| output:", String(result.output).slice(0, 100));
const runId = result.metadata?.runId ?? result.runId ?? result.taskId;
console.log("runId candidates — metadata.runId:", result.metadata?.runId, "| result.runId:", (result as any).runId, "| taskId:", result.taskId);

// Inspect the substrate directly
const db = new Database(DB, { readonly: true });
const tables = db.query("SELECT name FROM sqlite_master WHERE type='table'").all().map((r: any) => r.name);
console.log("tables:", tables.join(", "));
for (const t of ["runs", "run_checkpoints", "run_events"]) {
  if (tables.includes(t)) {
    const n = (db.query(`SELECT COUNT(*) c FROM ${t}`).get() as any).c;
    console.log(`${t}: ${n} rows`);
  }
}
if (tables.includes("run_checkpoints")) {
  const cp: any = db.query("SELECT run_id, iteration, LENGTH(state_json) len FROM run_checkpoints ORDER BY iteration").all();
  console.log("checkpoints:", JSON.stringify(cp));
  if (cp.length) {
    const state = JSON.parse((db.query("SELECT state_json FROM run_checkpoints ORDER BY iteration DESC LIMIT 1").get() as any).state_json);
    console.log("checkpoint state top-keys:", Object.keys(state).slice(0, 15).join(", "));
    console.log("=> FORK SUBSTRATE:", cp.length > 0 ? "PRESENT (per-iteration state snapshots on disk)" : "ABSENT");
  }
}
if (tables.includes("runs")) {
  console.log("runs rows:", JSON.stringify(db.query("SELECT run_id, status FROM runs").all()));
}
process.exit(0);
