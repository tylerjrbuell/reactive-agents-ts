// Run: bun test packages/reasoning/tests/kernel/seam-answer-turn.test.ts --timeout 20000
//
// Owner decision 2026-11-10 (Cortex run 01M73FK911EPZWMJAGSFZ7FPNB): the
// harness decides WHEN the model must answer; the model always writes the
// answer. The exit gate's one "write the final answer" turn (a deny-once whose
// outstanding items are all answer-shaped) is an ANSWER TURN: that one think
// call ships with no tools, so a small model cannot keep gathering instead.
// Tool work still outstanding (a required tool, a write target) keeps the tools.
import { describe, expect, it } from "bun:test";
import { Effect, Layer, Stream } from "effect";
import { EventBusLive } from "@reactive-agents/core";
import { LLMService, TestLLMService, type LLMErrors, type StreamEvent } from "@reactive-agents/llm-provider";
import { handleThinking } from "../../src/kernel/capabilities/reason/think.js";
import { answerTurnPending } from "../../src/kernel/capabilities/reason/answer-turn.js";
import { proposeExit } from "../../src/kernel/loop/exit-gate.js";
import { provideTestEnvelope } from "../../src/kernel/envelope/run-envelope.js";
import { makeStep } from "../../src/kernel/capabilities/sense/step-utils.js";
import { CONTEXT_PROFILES } from "../../src/context/context-profile.js";
import { makeKernelContext, makeKernelInput, makeKernelState } from "../../src/testing/kernel-fixtures.js";
import type { KernelMessage, KernelState } from "../../src/kernel/state/kernel-state.js";
import type { ReasoningStep } from "../../src/types/index.js";
import { harnessSynthesisDeliverable } from "@reactive-agents/core";

const TOOL = {
  name: "get-stats",
  description: "read site stats",
  parameters: [{ name: "page", type: "string", description: "page", required: true }],
};
const TASK = "Help me explore analytics for my docs site";
const HINT = "Not finished yet. Still outstanding:\n- write the final answer from the gathered tool results (only raw tool output exists so far)";

const gateStep = (record: NonNullable<NonNullable<ReasoningStep["metadata"]>["exitGate"]>): ReasoningStep =>
  makeStep("harness_signal", "exit gate", { exitGate: record });

const observation = (content: string): ReasoningStep =>
  makeStep("observation", content, { observationResult: { success: true, toolName: "get-stats" } } as never);

/** A gathered thread: N get-stats calls, each result `size` chars ending in a unique value. */
function gatheredThread(n: number, size: number): { messages: KernelMessage[]; steps: ReasoningStep[] } {
  const messages: KernelMessage[] = [];
  const steps: ReasoningStep[] = [];
  for (let i = 0; i < n; i++) {
    const content = `${"pageview row; ".repeat(Math.ceil(size / 14)).slice(0, size)} page${i}=VIEWS-${1000 + i}`;
    messages.push({ role: "assistant", content: "", toolCalls: [{ id: `c${i}`, name: "get-stats", arguments: { page: String(i) } }] } as KernelMessage);
    messages.push({ role: "tool_result", toolCallId: `c${i}`, toolName: "get-stats", content } as KernelMessage);
    steps.push(makeStep("action", `get-stats({"page":"${i}"})`, { toolUsed: "get-stats" } as never), observation(content));
  }
  return { messages, steps };
}

/** One real think call; returns what reached the wire. */
async function thinkOnce(state: KernelState, profile = CONTEXT_PROFILES.mid) {
  const seen = { tools: -1, system: "", messages: "" };
  const inner = TestLLMService([{ text: "Your docs site had 4,210 pageviews this month." }]);
  const llm = Layer.succeed(
    LLMService,
    LLMService.of({
      ...inner,
      stream: (request) => {
        seen.tools = request.tools?.length ?? 0;
        seen.system = request.systemPrompt ?? "";
        seen.messages = JSON.stringify(request.messages);
        return inner.stream(request) as Effect.Effect<Stream.Stream<StreamEvent, LLMErrors>, LLMErrors>;
      },
    }),
  );
  const context = makeKernelContext({
    input: makeKernelInput({ task: TASK, availableToolSchemas: [TOOL], allToolSchemas: [TOOL] }),
    profile,
  });
  await Effect.runPromise(provideTestEnvelope(handleThinking(state, context).pipe(Effect.provide(llm))));
  return seen;
}

describe("seam-answer-turn: the exit gate's write-the-answer turn ships no tools", () => {
  it("answerTurnPending: true only for the ONE think call right after an answer-turn denial", () => {
    const denied = gateStep({ proposedBy: "low_delta_guard", gateDecision: "deny-once", reason: "low_delta_guard", outstanding: ["write the final answer"], answerTurnAt: 9 });
    expect(answerTurnPending(makeKernelState({ llmCalls: 9, steps: [denied] }))).toBe(true);
    // That call was made: tools are offered again.
    expect(answerTurnPending(makeKernelState({ llmCalls: 10, steps: [denied] }))).toBe(false);
    // A denial with tool work outstanding is not an answer turn.
    const toolWork = gateStep({ proposedBy: "low_delta_guard", gateDecision: "deny-once", reason: "low_delta_guard", outstanding: ["call the `x` tool"] });
    expect(answerTurnPending(makeKernelState({ llmCalls: 9, steps: [toolWork] }))).toBe(false);
  });

  it("(a) the answer turn's LLM request carries NO tool schemas; the turn before offers them", async () => {
    const { messages, steps } = gatheredThread(2, 200);
    const denied = gateStep({ proposedBy: "low_delta_guard", gateDecision: "deny-once", reason: "low_delta_guard", outstanding: ["write the final answer from the gathered tool results (only raw tool output exists so far)"], answerTurnAt: 4 });
    const base = { messages, steps: [...steps, denied], pendingGuidance: { qualityGateHint: HINT } };
    const answerTurn = await thinkOnce(makeKernelState({ ...base, llmCalls: 4 }));
    expect(answerTurn.tools).toBe(0);
    // The gate's guidance reaches the model; no plain-text-strike instruction replaces it.
    expect(answerTurn.system + answerTurn.messages).toContain("write the final answer from the gathered tool results");
    expect(answerTurn.system + answerTurn.messages).not.toContain("tool-call text that could not be executed");
    const ordinary = await thinkOnce(makeKernelState({ ...base, llmCalls: 5 }));
    expect(ordinary.tools).toBeGreaterThan(0);
  });

  it("(c) the answer turn's prompt carries the task plus the compacted evidence and fits an 8k window", async () => {
    // 12 results × 3,000 chars ≈ 9k tokens raw: more than an 8k window holds.
    const { messages, steps } = gatheredThread(12, 3000);
    const denied = gateStep({ proposedBy: "low_delta_guard", gateDecision: "deny-once", reason: "low_delta_guard", outstanding: ["write the final answer"], answerTurnAt: 12 });
    const profile = { ...CONTEXT_PROFILES.local, maxTokens: 8192 };
    const seen = await thinkOnce(
      makeKernelState({ messages, steps: [...steps, denied], llmCalls: 12, pendingGuidance: { qualityGateHint: HINT } }),
      profile,
    );
    expect(seen.tools).toBe(0);
    const wire = seen.system + seen.messages;
    expect(wire).toContain(TASK);
    expect(wire).toContain("VIEWS-1011"); // the most recent evidence survives compaction
    expect(Math.ceil(wire.length / 4)).toBeLessThanOrEqual(8192);
  });

  it("the gate marks a deny-once as an answer turn only when every outstanding item is answer-shaped", async () => {
    const propose = (requiredTools: readonly string[]) =>
      Effect.runPromise(
        proposeExit({
          state: makeKernelState({ llmCalls: 3, steps: [observation("page0=VIEWS-1000")] }),
          proposal: {
            proposedBy: "low_delta_guard",
            kind: "soft",
            reason: "low_delta_guard",
            deliverable: harnessSynthesisDeliverable([], undefined, ""),
          },
          input: makeKernelInput({ task: TASK, requiredTools: [...requiredTools] }),
          maxIterations: 10,
          taskId: "t",
        }).pipe(Effect.provide(EventBusLive)),
      );
    const answerOnly = await propose([]);
    expect(answerOnly.decision).toBe("deny-once");
    expect(answerOnly.state.steps.at(-1)?.metadata?.exitGate?.answerTurnAt).toBe(3);
    expect(answerTurnPending(answerOnly.state)).toBe(true);
    const toolWork = await propose(["get-stats-detail"]);
    expect(toolWork.decision).toBe("deny-once");
    expect(toolWork.state.steps.at(-1)?.metadata?.exitGate?.answerTurnAt).toBeUndefined();
    expect(answerTurnPending(toolWork.state)).toBe(false);
  });
});
