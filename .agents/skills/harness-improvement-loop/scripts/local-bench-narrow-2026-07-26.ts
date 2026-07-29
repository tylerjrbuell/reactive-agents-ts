// local-bench-narrow-2026-07-26.ts — harness-warden probe (v2, single-model).
//
// v1 (2 ollama models resident alongside the judge model) thrashed GPU memory
// on this rig (RTX 4070 Ti Super 16GB: qwen3:4b + cogito:8b + gemma3:12b
// judge ~ 15.6GB resident, forcing CPU/GPU split + model-swap evictions —
// observed via `ollama ps` "70%/30% CPU/GPU" + repeated "Stopping..." during
// warm-up). v2 keeps ONE SUT model resident with the judge (qwen3:4b 2.6GB +
// gemma3:12b judge 8.1GB ~ 10.7GB, comfortably under 16GB) to isolate the
// bare-llm vs ra-full quality signal from GPU-contention noise.
//
// Run: JUDGE_URL=http://127.0.0.1:8911 timeout 560 bun run \
//   .agents/skills/harness-improvement-loop/scripts/local-bench-narrow-2026-07-26.ts

import type { BenchmarkSession } from "@reactive-agents/benchmarks";

const { runSession, getVariant } = await import("@reactive-agents/benchmarks");

const session: BenchmarkSession = {
  id: "local-models-narrow-v2",
  name: "Local Model Benchmark (narrowed probe v2, single model)",
  version: "1.0.0-probe",
  taskIds: ["rw-2"],
  models: [
    { id: "qwen3-4b", provider: "ollama", model: "qwen3:4b", contextTier: "local" },
  ],
  harnessVariants: [getVariant("bare-llm"), getVariant("ra-full")],
  runs: 1,
  traceDir: "benchmark-traces",
  concurrency: 1,
  timeoutMs: 150_000,
  logLevel: "progress",
};

const outputPath = process.argv[2] ?? "/tmp/claude-1000/local-bench-2026-07-26.json";
const t0 = Date.now();
console.log(`[probe] session start: ${new Date(t0).toISOString()}`);
const report = await runSession(session, outputPath);
const t1 = Date.now();
console.log(`[probe] session end: ${new Date(t1).toISOString()} | wall_ms=${t1 - t0}`);
const sumRunDurationMs = (report.taskReports ?? []).flatMap(r => r.runs ?? []).reduce((a: number, r: any) => a + (r.durationMs ?? 0), 0);
console.log(`[probe] sum(run.durationMs)=${sumRunDurationMs} | unattributed_ms(≈warmup+judge overhead)=${(t1 - t0) - sumRunDurationMs}`);
console.log(`\nDone. taskReports=${report.taskReports?.length ?? 0} partialMeasurement=${report.partialMeasurement}`);
