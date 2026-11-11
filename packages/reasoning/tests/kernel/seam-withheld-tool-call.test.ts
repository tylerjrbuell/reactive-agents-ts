// Run: bun test packages/reasoning/tests/kernel/seam-withheld-tool-call.test.ts --timeout 20000
//
// Ablation 2026-11-10 (stable-tool-list, mimo rw-7): on the exit gate's answer
// turn (think call shipped with NO tools) mimo returned a tool call anyway, 2 of
// 7 times; the kernel executed it and both runs failed with no answer. A tool
// call on a tools-withheld turn (the answer turn, or the strike-2 withhold
// after two unresolved tool-call replies) is refused: it never runs, the reply
// counts as no answer, and a guard observation records the refusal. On the
// strike withhold a second refusal ends the run honestly (tool_call_unresolved).
import { describe, expect, it } from "bun:test";
import { Effect, Layer, Stream } from "effect";
import { LLMService, TestLLMService, type LLMErrors, type StreamEvent } from "@reactive-agents/llm-provider";
import { handleThinking } from "../../src/kernel/capabilities/reason/think.js";
import {
  UNRESOLVED_STEP_META,
  WITHHELD_CALL_REFUSAL,
  unresolvedStrikesOf,
} from "../../src/kernel/capabilities/reason/unresolved-tool-call.js";
import { deliverableTextOf } from "../../src/kernel/capabilities/reason/assistant-turn.js";
import { provideTestEnvelope } from "../../src/kernel/envelope/run-envelope.js";
import { makeStep } from "../../src/kernel/capabilities/sense/step-utils.js";
import { CONTEXT_PROFILES } from "../../src/context/context-profile.js";
import { makeKernelContext, makeKernelInput, makeKernelState } from "../../src/testing/kernel-fixtures.js";
import type { KernelState } from "../../src/kernel/state/kernel-state.js";
import type { ReasoningStep } from "../../src/types/index.js";

const TOOL = {
  name: "get-stats",
  description: "read site stats",
  parameters: [{ name: "page", type: "string", description: "page", required: true }],
};
const CALL_TURN = { text: "Let me check one more page.", toolCall: { name: "get-stats", args: { page: "2" } } };

async function thinkOnce(state: KernelState) {
  const seen = { tools: -1 };
  const inner = TestLLMService([CALL_TURN]);
  const llm = Layer.succeed(
    LLMService,
    LLMService.of({
      ...inner,
      stream: (request) => {
        seen.tools = request.tools?.length ?? 0;
        return inner.stream(request) as Effect.Effect<Stream.Stream<StreamEvent, LLMErrors>, LLMErrors>;
      },
    }),
  );
  const context = makeKernelContext({
    input: makeKernelInput({ task: "Explore my docs site stats", availableToolSchemas: [TOOL], allToolSchemas: [TOOL] }),
    profile: CONTEXT_PROFILES.mid,
  });
  const out = await Effect.runPromise(provideTestEnvelope(handleThinking(state, context).pipe(Effect.provide(llm))));
  return { out, tools: seen.tools };
}

const observation = makeStep("observation", "page1=VIEWS-1001", {
  observationResult: { success: true, toolName: "get-stats" },
} as never);
const answerTurnGate = makeStep("harness_signal", "exit gate", {
  exitGate: { proposedBy: "low_delta_guard", gateDecision: "deny-once", reason: "low_delta_guard", outstanding: ["write the final answer"], answerTurnAt: 3 },
});

const refusedOnly = (before: KernelState, after: KernelState): readonly ReasoningStep[] => after.steps.slice(before.steps.length);

describe("seam-withheld-tool-call: a tool call on a tools-withheld turn is refused, never executed", () => {
  it("answer turn: the call does not run, the reply is no answer, the refusal is recorded", async () => {
    const state = makeKernelState({ llmCalls: 3, steps: [observation, answerTurnGate] });
    const { out, tools } = await thinkOnce(state);
    expect(tools).toBe(0); // the answer turn shipped no tools
    expect(out.status).not.toBe("acting"); // nothing handed to the act phase
    const added = refusedOnly(state, out);
    expect(added.some((s) => s.type === "action")).toBe(false);
    expect(added.at(-1)?.content).toBe(WITHHELD_CALL_REFUSAL);
    // Counts as no answer: the reply's thought has no deliverable view (never a
    // draft or fallback answer), and it is not a protocol strike — the run's own
    // cause stays its cause.
    const thought = added.find((s) => s.type === "thought");
    expect(thought && deliverableTextOf(thought)).toBe("");
    expect(unresolvedStrikesOf(out)).toBe(0);
    expect(out.output ?? "").toBe("");
  });

  it("strike withhold: the first call is refused (tools stay withheld), a second refusal terminates honestly", async () => {
    const shaped = () => makeStep("thought", '{"name":"nope","parameters":{}}', UNRESOLVED_STEP_META);
    const struck = makeKernelState({ llmCalls: 2, steps: [shaped(), shaped()] });
    const first = await thinkOnce(struck);
    expect(first.tools).toBe(0);
    expect(first.out.status).not.toBe("acting");
    expect(first.out.steps.at(-1)?.content).toBe(WITHHELD_CALL_REFUSAL);
    expect(unresolvedStrikesOf(first.out)).toBe(3);
    const second = await thinkOnce(first.out);
    expect(second.tools).toBe(0);
    expect(second.out.status).not.toBe("acting");
    expect(second.out.meta.terminatedBy).toBe("tool_call_unresolved");
  });
});
