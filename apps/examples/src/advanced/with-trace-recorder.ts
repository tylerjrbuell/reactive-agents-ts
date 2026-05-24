/**
 * Aspirational Example (xfail target): `.withTraceRecorder({ path })` builder hook
 *
 * GAP STATEMENT
 *   No `.withTraceRecorder({ path })` builder hook yet. `packages/trace/src/recorder.ts`
 *   exists but the public builder doesn't expose a persistent JSONL trace.
 *
 * SPEC (executable witness — must pass once the feature ships):
 *   const agent = await ReactiveAgents.create()
 *     .withProvider("test")
 *     .withReasoning()
 *     .withTraceRecorder({ path: "/tmp/trace.jsonl" })  // ← missing today
 *     .build();
 *   await agent.run("task");
 *   // /tmp/trace.jsonl now exists, parseable by loadRecordedRun from @reactive-agents/replay.
 *
 * When the builder hook ships:
 *   1. `loadRecordedRun("/tmp/trace.jsonl")` returns a valid RecordedRun.
 *   2. Drop `expectsFail: true` in apps/examples/index.ts in the same commit.
 *
 * Usage:
 *   bun run apps/examples/src/advanced/with-trace-recorder.ts
 */

import { ReactiveAgents } from "reactive-agents";
import { loadRecordedRun } from "@reactive-agents/replay";
import { existsSync, unlinkSync } from "node:fs";

export interface ExampleResult {
  passed: boolean;
  output: string;
  steps: number;
  tokens: number;
  durationMs: number;
}

const TRACE_PATH = "/tmp/with-trace-recorder.xfail.jsonl";

export async function run(_opts?: { provider?: string; model?: string }): Promise<ExampleResult> {
  const start = Date.now();
  console.log("=== Aspirational: .withTraceRecorder({ path }) ===\n");

  // best-effort cleanup of any prior run
  try { if (existsSync(TRACE_PATH)) unlinkSync(TRACE_PATH); } catch {}

  let builderError: string | null = null;
  let buildSucceeded = false;
  let ranAgent = false;

  try {
    let b: any = ReactiveAgents.create()
      .withName("xfail-trace-recorder")
      .withProvider("test")
      .withTestScenario([{ match: "trace me", text: "ok, traced." }])
      .withReasoning();

    // The aspirational hook. Cast through `any` because TypeScript does not yet
    // know about this method — that is the gap.
    if (typeof b.withTraceRecorder !== "function") {
      builderError =
        "No .withTraceRecorder({ path }) builder hook yet. " +
        "packages/trace/src/recorder.ts exists but the public builder " +
        "doesn't expose a persistent JSONL trace.";
    } else {
      b = b.withTraceRecorder({ path: TRACE_PATH });
      const agent = await b.withMaxIterations(2).build();
      buildSucceeded = true;
      await agent.run("trace me");
      ranAgent = true;
    }
  } catch (err) {
    builderError =
      builderError ??
      `.withTraceRecorder threw at build/run: ${(err as Error).message}`;
  }

  // If the hook still doesn't exist, fail loudly with the gap statement.
  if (builderError) {
    return {
      passed: false,
      output: builderError,
      steps: 0,
      tokens: 0,
      durationMs: Date.now() - start,
    };
  }

  // Hook *exists* — now verify it actually produced a parseable JSONL trace.
  if (!existsSync(TRACE_PATH)) {
    return {
      passed: false,
      output:
        `.withTraceRecorder ran (build=${buildSucceeded}, run=${ranAgent}) ` +
        `but produced no file at ${TRACE_PATH}. ` +
        "TraceRecorderService.flush() likely not wired to disk.",
      steps: 0,
      tokens: 0,
      durationMs: Date.now() - start,
    };
  }

  try {
    const recorded = await loadRecordedRun(TRACE_PATH);
    const passed =
      typeof recorded.runId === "string" &&
      Array.isArray(recorded.trace.events) &&
      recorded.trace.events.length > 0;
    return {
      passed,
      output: passed
        ? `Loaded RecordedRun ${recorded.runId} with ${recorded.trace.events.length} events from ${TRACE_PATH}`
        : `Loaded ${TRACE_PATH} but it has no events — recorder did not flush trace events.`,
      steps: recorded.trace.events.length,
      tokens: 0,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      passed: false,
      output: `loadRecordedRun(${TRACE_PATH}) failed: ${(err as Error).message}`,
      steps: 0,
      tokens: 0,
      durationMs: Date.now() - start,
    };
  } finally {
    try { if (existsSync(TRACE_PATH)) unlinkSync(TRACE_PATH); } catch {}
  }
}

if (import.meta.main) {
  run().then((r) => {
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.passed ? 0 : 1);
  });
}
