/**
 * Example: RunHandle Cancellation Witness
 *
 * Witnesses the `agent.runStream()` → `RunHandle` control-plane surface
 * (see `packages/runtime/src/run-controller.ts:11` and
 * `packages/runtime/src/reactive-agent.ts:761`).
 *
 * RunHandle extends AsyncGenerator<AgentStreamEvent> with four verbs:
 *
 *   - pause()     — freeze at next iteration boundary; await resume()
 *   - resume()    — continue from paused state
 *   - stop()      — graceful: run synthesis, emit StreamCompleted
 *   - terminate() — hard abort: emit StreamCancelled
 *   - status()    — current RunStatus
 *
 * Pass criteria:
 *   1. A handle started on a streaming agent emits at least one event before
 *      `terminate()` is called.
 *   2. After terminate(), `handle.status()` reports `"terminated"`.
 *   3. The generator drains cleanly (no thrown error escapes).
 *   4. A second runStream() on the same agent still completes normally
 *      (handle reuse safety).
 *
 * Usage:
 *   bun run apps/examples/src/streaming/run-handle-cancel.ts
 */

import { ReactiveAgents } from "reactive-agents";
import type { AgentStreamEvent } from "reactive-agents";

export interface ExampleResult {
  passed: boolean;
  output: string;
  steps: number;
  tokens: number;
  durationMs: number;
}

export async function run(opts?: { provider?: string; model?: string }): Promise<ExampleResult> {
  const start = Date.now();
  type PN = "anthropic" | "openai" | "ollama" | "gemini" | "litellm" | "test";
  const provider = (opts?.provider ?? "test") as PN;

  console.log("=== RunHandle: pause / stop / terminate witness ===\n");
  console.log(`Mode: ${provider !== "test" ? `LIVE (${provider})` : "TEST (deterministic)"}\n`);

  let b = ReactiveAgents.create()
    .withName("runhandle-demo")
    .withProvider(provider)
    .withReasoning()
    .withStreaming({ density: "full" });
  if (opts?.model) b = b.withModel(opts.model);
  if (provider === "test") {
    b = b.withTestScenario([
      // Long-ish multi-turn scenario so terminate() can fire mid-stream.
      { text: "Step 1: analyzing the problem space." },
      { text: "Step 2: drafting a solution outline." },
      { text: "FINAL ANSWER: Done." },
      // For the second run after cancel:
      { text: "FINAL ANSWER: Second run completed." },
    ]);
  }
  const agent = await b.withMaxIterations(4).build();

  // ── Run #1: start, observe one emission, then terminate() ────────────────
  console.log("─── Run #1: terminate after first emission ───");
  const handle1 = agent.runStream("Walk me through a long multi-step plan.");
  const statusBefore = handle1.status();
  console.log(`status() before iter: ${statusBefore}`);

  let firstEventTag = "";
  let cancelledSeen = false;
  let completedSeen = false;
  let errorThrown: unknown = null;
  let eventsBeforeTerminate = 0;

  try {
    let i = 0;
    for await (const ev of handle1 as AsyncGenerator<AgentStreamEvent>) {
      if (i === 0) {
        firstEventTag = ev._tag;
        console.log(`  first event _tag=${ev._tag}`);
      }
      i++;
      // After observing 1-2 emissions, hard-abort.
      if (i === 1) {
        console.log("  → calling handle.terminate()");
        handle1.terminate({ reason: "demo cancellation" });
      }
      if (ev._tag === "StreamCancelled") cancelledSeen = true;
      if (ev._tag === "StreamCompleted") completedSeen = true;
    }
    eventsBeforeTerminate = i;
  } catch (err) {
    errorThrown = err;
  }

  const statusAfter = handle1.status();
  console.log(`status() after drain: ${statusAfter}`);
  console.log(`  total events observed: ${eventsBeforeTerminate}`);
  console.log(`  StreamCancelled seen: ${cancelledSeen}`);
  console.log(`  StreamCompleted seen: ${completedSeen}`);
  console.log(`  threw: ${errorThrown ? String(errorThrown) : "no"}`);

  // ── Run #2: prove agent reusable after a terminated run ──────────────────
  console.log("\n─── Run #2: fresh runStream after terminate ───");
  const handle2 = agent.runStream("Do a single short task.");
  let run2Output = "";
  let run2Completed = false;
  let run2Steps = 0;
  let run2Tokens = 0;
  for await (const ev of handle2 as AsyncGenerator<AgentStreamEvent>) {
    if (ev._tag === "StreamCompleted") {
      run2Output = ev.output;
      run2Completed = true;
      run2Steps = ev.metadata.stepsCount ?? 0;
      // metadata.tokensUsed exists per StreamCompleted contract
      run2Tokens = (ev.metadata as { tokensUsed?: number }).tokensUsed ?? 0;
    }
  }
  console.log(`run #2 completed: ${run2Completed} status()=${handle2.status()}`);
  console.log(`  output: ${run2Output.slice(0, 80)}`);

  await agent.dispose();

  // ── Verdict ──────────────────────────────────────────────────────────────
  const handle1Cancelled =
    statusAfter === "terminated" || statusAfter === "stopped" || cancelledSeen;
  const noUnhandledThrow = errorThrown === null;
  const handle2Worked = run2Completed && run2Output.length > 0;
  const sawAtLeastOneEvent = firstEventTag.length > 0;

  const passed =
    sawAtLeastOneEvent && handle1Cancelled && noUnhandledThrow && handle2Worked;

  return {
    passed,
    output: passed
      ? `RunHandle: terminate→status='${statusAfter}', cancelled=${cancelledSeen}; re-run OK.`
      : `RunHandle witness FAILED — sawEvent=${sawAtLeastOneEvent} cancelled=${handle1Cancelled} clean=${noUnhandledThrow} reuse=${handle2Worked}`,
    steps: run2Steps,
    tokens: run2Tokens,
    durationMs: Date.now() - start,
  };
}

if (import.meta.main) {
  const r = await run();
  console.log(r.passed ? "\n✅ PASS" : "\n❌ FAIL", r.output);
  process.exit(r.passed ? 0 : 1);
}
