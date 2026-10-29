/**
 * Runner pin: after a strategy switch, a (small) model that parrots the
 * handoff summary back as its terminal answer must not ship that text.
 * The scripted kernel emits the REAL handoff block (built by the same
 * `buildHandoffSummary` the switch uses) as its terminal output.
 */
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { runKernel } from "../../../src/kernel/loop/runner.js";
import {
  transitionState,
  type KernelState,
  type ThoughtKernel,
} from "../../../src/kernel/state/kernel-state.js";
import { makeStep } from "../../../src/kernel/capabilities/sense/step-utils.js";
import {
  buildHandoffSummary,
  looksLikeHarnessInternalText,
} from "../../../src/kernel/capabilities/verify/harness-internal-text.js";

const LOOP_ACTION = JSON.stringify({ tool: "web-search", input: '{"query":"loop-trigger"}' });
const PARROT = buildHandoffSummary({
  switchNumber: 1,
  previousStrategy: "reactive",
  stepsCompleted: 0,
  failureReason: "tool-unavailable (web-search)",
  toolsCalled: [],
  permanentlyFailedTools: ["web-search"],
  keyObservations: [],
});

const parrotKernel = (): ThoughtKernel => (state: KernelState) =>
  Effect.succeed(
    state.strategy !== "reactive"
      ? transitionState(state, {
          status: "done",
          output: PARROT,
          iteration: state.iteration + 1,
          steps: [...state.steps, makeStep("thought", PARROT)],
        })
      : transitionState(state, {
          status: "thinking",
          iteration: state.iteration + 1,
          steps: [...state.steps, makeStep("action", LOOP_ACTION)],
        }),
  );

describe("handoff parrot after strategy switch", () => {
  it("fixture is recognised as harness-internal text", () => {
    expect(looksLikeHarnessInternalText(PARROT)).toBe(true);
  });

  it("delivered output carries no handoff marker text", async () => {
    const result = await Effect.runPromise(
      runKernel(parrotKernel(), { task: "say hello" }, {
        maxIterations: 20,
        strategy: "reactive",
        kernelType: "react",
        loopDetection: { maxSameToolCalls: 3 },
        strategySwitching: {
          enabled: true,
          maxSwitches: 1,
          fallbackStrategy: "plan-execute-reflect",
          availableStrategies: ["plan-execute-reflect"],
        },
      }).pipe(Effect.provide(TestLLMServiceLayer())),
    );
    expect(result.strategy).toBe("plan-execute-reflect");
    expect(result.output ?? "").not.toBe(PARROT);
    expect(looksLikeHarnessInternalText(result.output)).toBe(false);
    expect(result.output ?? "").not.toContain("Permanently unavailable tools");
  }, 15000);
});
