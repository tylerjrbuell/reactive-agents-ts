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
 *
 * SECOND regression (found in review): a consumer that just stops consuming —
 * `break`s out of its `for await` loop, throws, or gets interrupted upstream —
 * WITHOUT ever calling `handle.terminate()` — hits the exact same bug via a
 * different path. `reactive-agent.ts`'s `_runStreamImpl` `finally` block used
 * to interrupt only the local CONSUMER fiber and call `controller
 * .markCompleted()`; it never touched `controller`'s `AbortController`, so
 * neither `execute-stream.ts`'s signal listener nor `checkpoint()`'s terminate
 * check ever tripped, and the producer ran on unobserved — reviewer-confirmed
 * 1→4 provider calls over ~800ms on the pre-fix code. Fixed by having that
 * `finally` block call `controller.terminate()` whenever the generator stops
 * WITHOUT the consumer effect having reached a terminal item itself (tracked
 * via `reachedTerminal`) — i.e. any exit that is not a natural completion.
 * The second test below is that scenario, formalized.
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

// A long scripted scenario — one file-write tool call per iteration — so an
// unfixed build has plenty of remaining iterations left to (wrongly) keep
// calling the provider after the consumer walks away, inside the 500ms
// window each test below waits out. TestLLMService repeats the last turn
// once exhausted, so this length is just "long enough", not a hard ceiling.
const SCENARIO_LENGTH = 30;

function makeScenario(pathPrefix: string): TestTurn[] {
  return Array.from({ length: SCENARIO_LENGTH }, (_, i) => ({
    toolCall: {
      id: `t${i}`,
      name: "file-write",
      args: { path: `./${pathPrefix}/${i}.txt`, content: "x" },
    },
  }));
}

async function buildAgent(name: string, counter: { count: number }) {
  return ReactiveAgents.create()
    .withName(name)
    .withTools({ builtins: ["file-write"] })
    .withReplayLLM(makeCapturingLayer(makeScenario(name), counter))
    .build();
}

describe("stream termination stops the run (FM-5)", () => {
  it("terminating a stream mid-run issues no further provider calls", async () => {
    const counter = { count: 0 };
    const agent = await buildAgent("fm5-terminate-test", counter);

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
    expect(counter.count).toBeLessThan(SCENARIO_LENGTH);

    const countAtTermination = counter.count;
    // Give an unfixed build's orphaned daemon fiber time to keep issuing
    // provider calls if the termination signal has no reader.
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(counter.count).toBe(countAtTermination);
  }, 20000);

  it("a consumer that just stops consuming (no terminate() call) issues no further provider calls", async () => {
    // Reviewer repro, formalized: `break` out of the `for await` loop with NO
    // call to `handle.terminate()` / no AbortSignal at all — simulating a
    // caller that stops reading the stream, throws, or whose own fiber gets
    // interrupted upstream. This must stop the producer via
    // `_runStreamImpl`'s `finally` block forcing `controller.terminate()` on
    // any non-natural exit, NOT via the explicit-terminate() path the first
    // test above exercises.
    const counter = { count: 0 };
    const agent = await buildAgent("fm5-abandoned-consumer-test", counter);

    const handle = agent.runStream(
      "write many files, one tool call per iteration, until told to stop",
    );

    let seen = 0;
    for await (const _event of handle) {
      seen++;
      if (seen === 2) {
        // No handle.terminate() here — just walk away.
        break;
      }
    }

    expect(counter.count).toBeGreaterThan(0);
    expect(counter.count).toBeLessThan(SCENARIO_LENGTH);

    const countAtAbandon = counter.count;
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(counter.count).toBe(countAtAbandon);
  }, 20000);
});
