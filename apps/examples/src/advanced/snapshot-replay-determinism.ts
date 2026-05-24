/**
 * Example: Snapshot / Replay Determinism Witness
 *
 * Witnesses the public surface of `@reactive-agents/replay` (shipped May 14):
 *
 *   - `snapshotFromRecordedRun()` — extract a TraceSnapshot from a RecordedRun
 *   - `snapshotFromAgentResult()` — same shape from a live agent outcome
 *   - `diffTraces()` — structural diff of two snapshots
 *   - `replay()` — re-run a recorded run through a builder fn and diff the output
 *
 * Pass criterion: a deterministic builder that re-emits the original outcome
 * produces a `ReplayDiff` with `identical: true` and zero tool-sequence edits.
 *
 * KNOWN LIMITATION (documented for caller follow-up):
 * The current public builder API does not expose a `.withTrace()` /
 * `.withTraceRecorder()` hook that would persist a JSONL trace to disk
 * from an end-to-end agent run. `packages/trace/src/recorder.ts` exists as
 * a wired-but-unsurfaced Effect service. Until that surface lands, this
 * example constructs a synthetic `RecordedRun` from in-memory `TraceEvent`s
 * to exercise the replay-package contract. The diff/snapshot path is the
 * same one that consumes recorder output via `loadRecordedRun()`.
 *
 * Once `.withTraceRecorder({ path })` is shipped, the recording arm of this
 * example should be replaced with a real agent run + `loadRecordedRun(path)`.
 *
 * Usage:
 *   bun run apps/examples/src/advanced/snapshot-replay-determinism.ts
 */

import {
  replay,
  snapshotFromRecordedRun,
  snapshotFromAgentResult,
  diffTraces,
  computeArgsHash,
  buildToolTable,
} from "@reactive-agents/replay";
import type { RecordedRun, AgentRunOutcome } from "@reactive-agents/replay";
import type { TraceEvent } from "@reactive-agents/trace";

export interface ExampleResult {
  passed: boolean;
  output: string;
  steps: number;
  tokens: number;
  durationMs: number;
}

export async function run(_opts?: { provider?: string; model?: string }): Promise<ExampleResult> {
  const start = Date.now();
  console.log("=== Snapshot / Replay Determinism Witness ===\n");

  // ── Construct a synthetic RecordedRun ─────────────────────────────────────
  // Mirrors what TraceRecorderService would write to JSONL during a real run.
  const runId = "demo-run-001";
  const task = "Look up the weather and summarize.";
  const model = "test-model";
  const finalOutput = "It is 72°F and sunny.";

  const events: TraceEvent[] = [
    {
      runId,
      timestamp: 1_700_000_000_000,
      iter: -1,
      seq: 0,
      kind: "run-started",
      task,
      model,
      provider: "test",
      config: {},
    } as TraceEvent,
    {
      runId,
      timestamp: 1_700_000_000_100,
      iter: 0,
      seq: 1,
      kind: "iteration-enter",
    } as TraceEvent,
    {
      runId,
      timestamp: 1_700_000_000_200,
      iter: 0,
      seq: 2,
      kind: "tool-call-end",
      toolName: "weather-lookup",
      args: { city: "SF" },
      result: { temp: 72, sky: "sunny" },
      ok: true,
      durationMs: 50,
    } as unknown as TraceEvent,
    {
      runId,
      timestamp: 1_700_000_000_250,
      iter: 0,
      seq: 3,
      kind: "entropy-scored",
      composite: 0.42,
      sources: {
        token: 0.3,
        structural: 0.5,
        semantic: 0.4,
        behavioral: 0.4,
        contextPressure: 0.4,
      },
    } as unknown as TraceEvent,
    {
      runId,
      timestamp: 1_700_000_000_300,
      iter: 0,
      seq: 4,
      kind: "iteration-exit",
    } as TraceEvent,
    {
      runId,
      timestamp: 1_700_000_000_400,
      iter: 0,
      seq: 5,
      kind: "run-completed",
      status: "success",
      output: finalOutput,
      totalTokens: 42,
      totalCostUsd: 0.0001,
      durationMs: 400,
    } as TraceEvent,
  ];

  const recordedRun: RecordedRun = {
    runId,
    task,
    model,
    provider: "test",
    config: {},
    trace: { runId, events },
    toolTable: buildToolTable(events),
  };

  console.log(`Constructed RecordedRun: ${runId}`);
  console.log(`  task: ${task}`);
  console.log(`  events: ${events.length}, toolTable entries: ${recordedRun.toolTable.size}`);

  // ── Snapshot the original ─────────────────────────────────────────────────
  const original = snapshotFromRecordedRun(recordedRun);
  console.log(`\nOriginal snapshot:`);
  console.log(`  iterations=${original.iterations}, toolCalls=${original.toolCalls.length}, tokens=${original.totalTokens}, output="${original.output}"`);

  // ── Self-replay: a builder that re-emits the recorded outcome ─────────────
  // A real replay would route LLM calls through a deterministic stub and
  // dispense tool results from `recordedRun.toolTable` via `makeReplayToolLayer`.
  // For this witness we replay-via-identity to assert the diff math holds.
  const replayResult = await replay(recordedRun, async () => ({
    run: async (_input: string): Promise<AgentRunOutcome> => ({
      output: finalOutput,
      totalTokens: 42,
      totalCostUsd: 0.0001,
      durationMs: 400,
      // Match `traceStats(original).iterations`. `traceStats` derives iteration
      // count from the highest `iter` on entropy-scored / kernel-state-snapshot
      // events (see packages/trace/src/replay.ts:54). Trace above contains one
      // entropy-scored at `iter:0`, so the original snapshot reports `iterations: 1`.
      iterations: 1,
      toolCalls: [
        {
          toolName: "weather-lookup",
          argsHash: computeArgsHash({ city: "SF" }),
          ok: true,
        },
      ],
    }),
  }));

  console.log(`\nReplay snapshot:`);
  console.log(`  iterations=${replayResult.replay.iterations}, toolCalls=${replayResult.replay.toolCalls.length}, tokens=${replayResult.replay.totalTokens}, output="${replayResult.replay.output}"`);

  console.log(`\nReplayDiff:`);
  console.log(`  identical=${replayResult.diff.identical}`);
  console.log(`  iterationsDelta=${replayResult.diff.iterationsDelta}`);
  console.log(`  toolSequenceDiff edits=${replayResult.diff.toolSequenceDiff.length}`);
  console.log(`  tokensDelta=${replayResult.diff.tokensDelta} costDelta=${replayResult.diff.costDelta}`);
  console.log(`  outputDiff.equal=${replayResult.diff.outputDiff.equal}`);

  // ── Demonstrate divergence detection ──────────────────────────────────────
  // Run a *different* outcome through `snapshotFromAgentResult` + `diffTraces`
  // to prove the diff catches drift.
  const driftedOutcome: AgentRunOutcome = {
    output: "It is freezing.",
    totalTokens: 99,
    totalCostUsd: 0.0001,
    durationMs: 400,
    iterations: 2,
    toolCalls: [
      {
        toolName: "weather-lookup",
        argsHash: computeArgsHash({ city: "NYC" }),
        ok: true,
      },
    ],
  };
  const driftedSnap = snapshotFromAgentResult(driftedOutcome, recordedRun);
  const driftDiff = diffTraces(original, driftedSnap);
  console.log(`\nDrift detection (replaying with mismatched outcome):`);
  console.log(`  identical=${driftDiff.identical} iterationsDelta=${driftDiff.iterationsDelta} tokensDelta=${driftDiff.tokensDelta}`);
  console.log(`  toolSequenceDiff has ${driftDiff.toolSequenceDiff.length} edit(s)`);

  const determinismHeld = replayResult.diff.identical === true;
  const driftDetected = driftDiff.identical === false && driftDiff.toolSequenceDiff.length > 0;
  const passed = determinismHeld && driftDetected;

  return {
    passed,
    output: passed
      ? "replay identical=true; drift detected on mismatched outcome."
      : `replay determinism=${determinismHeld}, drift detected=${driftDetected}`,
    steps: original.iterations,
    tokens: original.totalTokens,
    durationMs: Date.now() - start,
  };
}

if (import.meta.main) {
  const r = await run();
  console.log(r.passed ? "\n✅ PASS" : "\n❌ FAIL", r.output);
  process.exit(r.passed ? 0 : 1);
}
