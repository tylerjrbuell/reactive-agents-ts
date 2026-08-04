/**
 * P3b — Durable rail via runStream (correct `dir` option)
 */
import { ReactiveAgents } from "reactive-agents";
import { Database } from "bun:sqlite";
import { rmSync } from "node:fs";

const DIR = "/tmp/claude-1000/p3b-runs";
try { rmSync(DIR, { recursive: true }); } catch {}

const agent = await ReactiveAgents.create()
  .withName("p3b-durable")
  .withProvider("ollama")
  .withModel("qwen3:4b")
  .withTools(["calculator"])
  .withDurableRuns({ dir: DIR, checkpointEvery: 1 })
  .withReasoning({ strategy: "reactive" })
  .withMaxIterations(6)
  .build();

const handle = agent.runStream("Use the calculator: 44*17, then that times 3. Final number?") as any;
let runIdFromEvents: string | undefined;
const tagCount: Record<string, number> = {};
for await (const ev of handle) {
  const t = (ev as any)._tag ?? "?";
  tagCount[t] = (tagCount[t] ?? 0) + 1;
  if ((ev as any).runId && !runIdFromEvents) runIdFromEvents = (ev as any).runId;
}
console.log("=== P3b DURABLE (runStream) ===");
console.log("event tags:", JSON.stringify(tagCount));
console.log("runId surfaced in events:", runIdFromEvents ?? "NONE");

const db = new Database(`${DIR}/runs.db`, { readonly: true });
const tables = db.query("SELECT name FROM sqlite_master WHERE type='table'").all().map((r: any) => r.name).sort();
console.log("tables:", tables.join(", "));
for (const t of tables) {
  const n = (db.query(`SELECT COUNT(*) c FROM "${t}"`).get() as any).c;
  console.log(`  ${t}: ${n} rows`);
}
const cps: any[] = db.query("SELECT run_id, iteration, LENGTH(state_json) len FROM run_checkpoints ORDER BY iteration").all();
console.log("checkpoints:", JSON.stringify(cps));
if (cps.length) {
  const state = JSON.parse((db.query("SELECT state_json FROM run_checkpoints ORDER BY iteration DESC LIMIT 1").get() as any).state_json);
  console.log("state top-keys:", Object.keys(state).slice(0, 18).join(", "));
}
const evs: any[] = db.query("SELECT COUNT(*) c FROM run_events").all();
console.log("journaled events:", JSON.stringify(evs));
console.log("runs:", JSON.stringify(db.query("SELECT run_id, status FROM runs").all()));
process.exit(0);
