// Run: bun test packages/runtime/tests/stream-terminate-no-further-calls.test.ts --timeout 20000
/**
 * FM-5 (Phase 4 Task 4) red-on-cut acceptance test: terminating a stream
 * mid-run must issue no further provider calls.
 *
 * INJECTION SEAM: `.withReplayLLM()` with a capturing `LLMService` layer
 * (same pattern as `model-routing-e2e.test.ts`'s `makeCapturingLayer`) — this
 * is the only way to count provider calls deterministically without live
 * cloud-provider credits.
 *
 * Before this fix, `execute-stream.ts` ran the reasoning loop on a daemon
 * fiber (`Effect.forkDaemon`) with no reader for `RunController.terminate()`'s
 * abort — `RunHandle.terminate()` stopped the STREAM CONSUMER
 * (`reactive-agent.ts`'s `_runStreamImpl`) but left the underlying kernel
 * loop running orphaned in the background, issuing further provider calls
 * for every remaining scripted tool call. The fix threads `terminate()`
 * two ways: (a) `checkpoint()` (run-controller.ts) now reports a hard
 * terminate distinctly from a graceful stop, and the kernel loop
 * (iterate-pass.ts) exits before its NEXT provider call; (b) execute-stream.ts
 * captures the producer fiber and interrupts it immediately on abort, for the
 * case where a call is already in flight.
 */
import { describe, it, expect } from "bun:test";
import { Layer } from "effect";
import { ReactiveAgents } from "../src/builder.js";
import { LLMService, TestLLMService, type TestTurn } from "@reactive-agents/llm-provider";

/**
 * Build a Layer that wraps TestLLMService and counts every complete()/stream()
 * call, so the test can assert "no further provider calls after termination"
 * without live credits. Mirrors model-routing-e2e.test.ts's makeCapturingLayer.
 */
function makeCapturingLayer(
  scenario: TestTurn[],
  counter: { count: number },
): Layer.Layer<LLMService> {
  const base = TestLLMService(scenario);
  return Layer.succeed(
    LLMService,
    LLMService.of({
      ...base,
      complete: (request) => {
        counter.count++;
        return base.complete(request);
      },
      stream: (request) => {
        counter.count++;
        return base.stream(request);
      },
    }),
  );
}

describe("stream termination stops the run (FM-5)", () => {
  it("terminating a stream mid-run issues no further provider calls", async () => {
    const counter = { count: 0 };
    // A long scripted scenario — one file-write tool call per iteration — so
    // an unfixed build has plenty of remaining iterations left to (wrongly)
    // keep calling the provider after termination, inside the 500ms window
    // below. TestLLMService repeats the last turn once exhausted, so the
    // scenario length itself is just "long enough", not a hard ceiling.
    const scenarioLength = 30;
    const scenario: TestTurn[] = Array.from({ length: scenarioLength }, (_, i) => ({
      toolCall: {
        id: `t${i}`,
        name: "file-write",
        args: { path: `./fm5-terminate-test/${i}.txt`, content: "x" },
      },
    }));

    const agent = await ReactiveAgents.create()
      .withName("fm5-terminate-test")
      .withTools({ builtins: ["file-write"] })
      .withReplayLLM(makeCapturingLayer(scenario, counter))
      .build();

    const handle = agent.runStream(
      "write many files, one tool call per iteration, until told to stop",
    );

    let seen = 0;
    for await (const _event of handle) {
      seen++;
      if (seen === 2) {
        handle.terminate();
        break;
      }
    }

    // Non-vacuity guard: the recording layer was actually invoked and the
    // run was genuinely mid-flight (nowhere near the full scenario length)
    // at the moment of termination.
    expect(counter.count).toBeGreaterThan(0);
    expect(counter.count).toBeLessThan(scenarioLength);

    const countAtTermination = counter.count;
    // Give an unfixed build's orphaned daemon fiber time to keep issuing
    // provider calls if the termination signal has no reader.
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(counter.count).toBe(countAtTermination);
  }, 20000);
});
