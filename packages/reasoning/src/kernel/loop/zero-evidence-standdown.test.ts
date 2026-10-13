// Run: bun test packages/reasoning/src/kernel/loop/zero-evidence-standdown.test.ts --timeout 15000
//
// W4-live — default-on zero-evidence stand-down (plan 4.2 reconciliation arm).
//
// The live defect (trace 01M4VE09E4J99K77DGNWA95J96): an impossible task (no
// capable tool) looped ~6 iterations / ~23s / ~2K tokens before abstaining,
// because the sustained-zero-evidence signal (assess() evidenceDelta) was
// computed but never ACTED on by default — the band reported "green" and
// pattern (e) was horizon-gated. This pins the default-on actuator: an
// ungrounded run with no deliverable and outstanding requirements that produces
// NO new evidence for 2 iterations abstains honestly — and a run that IS
// progressing is NOT terminated (false-positive guard).
import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { reactKernel } from "./react-kernel.js";
import { runPass } from "./run-pass.js";
import { runKernel } from "./runner.js";
import {
  transitionState,
  type KernelState,
  type ThoughtKernel,
} from "../state/kernel-state.js";
import { makeStep } from "../capabilities/sense/step-utils.js";
import { makeObservationResult } from "../utils/observation-helpers.js";

const testLayer = TestLLMServiceLayer();

/**
 * A real LLM-driven trajectory (tokens > 0): TestLLMService answers every turn
 * with a non-answer ("Test response"), so the reactive kernel keeps thinking and
 * never reaches a terminal answer — the live impossible-task shape.
 */
const runImpossible = (task: string, maxIterations = 20) =>
  Effect.runPromise(
    runPass(reactKernel, { task }, {
      maxIterations,
      strategy: "reactive",
      kernelType: "react",
      taskId: "zero-evidence-standdown-test",
    }).pipe(Effect.provide(testLayer)),
  );

/**
 * A stub kernel that lands a SUCCESSFUL substantive tool result every iteration
 * — genuine progress. The stand-down must NOT fire.
 */
function makeProgressingKernel(): ThoughtKernel {
  let n = 0;
  return (state: KernelState) => {
    n++;
    const id = `call-${n}`;
    return Effect.succeed(
      transitionState(state, {
        status: "thinking",
        iteration: state.iteration + 1,
        steps: [
          ...state.steps,
          makeStep("action", JSON.stringify({ tool: "file-read", input: `{"path":"./f${n}"}` }), {
            toolCall: { id, name: "file-read", arguments: { path: `./f${n}` } },
          }),
          makeStep("observation", `Widget revenue ${n}`, {
            toolCallId: id,
            observationResult: makeObservationResult("file-read", true, `Widget revenue ${n}`),
          }),
        ],
      }),
    );
  };
}

const runStub = (kernel: ThoughtKernel, task: string, maxIterations = 20) =>
  Effect.runPromise(
    runKernel(kernel, { task }, {
      maxIterations,
      strategy: "reactive",
      kernelType: "react",
      taskId: "zero-evidence-standdown-test",
    }).pipe(Effect.provide(testLayer)),
  );

describe("W4-live — default-on zero-evidence stand-down", () => {
  it("impossible task abstains honestly within <=2 iterations (NOT horizon-gated)", async () => {
    const pass = await runImpossible(
      "Send a slack message to #general saying 'Hello team'",
    );
    expect(pass.state.meta.terminatedBy).toBe("abstained");
    expect(pass.state.tokens).toBeGreaterThan(0);
    // <=2 thinking iterations — the efficient default, not a 4-5 iteration grind.
    expect(pass.state.steps.filter((s) => s.type === "thought").length).toBeLessThanOrEqual(2);
    // Honest, named reason on the abstention channel.
    const abstention = pass.state.meta.abstention as { reason?: string } | undefined;
    expect(abstention?.reason ?? "").toContain("no new task evidence");
  }, 15000);

  it("FALSE-POSITIVE GUARD: a run landing new substantive evidence every iteration is NOT stood down", async () => {
    const result = await runStub(makeProgressingKernel(), "Read the sales files and report totals");
    expect(result.meta?.terminatedBy).not.toBe("abstained");
    expect(result.steps.filter((s) => s.type === "action").length).toBeGreaterThan(2);
  }, 15000);
});
