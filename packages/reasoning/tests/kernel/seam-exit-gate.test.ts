// Run: bun test packages/reasoning/tests/kernel/seam-exit-gate.test.ts --timeout 20000
//
// Plan 8 queue item 3 (OSS gaps G1 + G2): no guard, cap or early-stop ends a run
// on its own authority. Each exit is a PROPOSAL to the exit gate
// (kernel/loop/exit-gate.ts), which accepts it, denies it once with guidance
// naming what is outstanding, or ends the run as a handoff; a handoff gets ONE
// synthesis (kernel/loop/handoff-synthesis.ts) that writes the best answer from
// the evidence plus an explicit unfinished list.
//
// Scripted kernels drive the REAL runner (guards, gate, terminal gate). The LLM
// is called only post-loop here, so every recorded prompt is a harness call.
import { describe, expect, it } from "bun:test";
import { Effect, Layer } from "effect";
import { EventBus, EventBusLive, sentinelDeliverable } from "@reactive-agents/core";
import { LLMService, TestLLMServiceLayer, type TestTurn } from "@reactive-agents/llm-provider";
import { runKernel } from "../../src/kernel/loop/runner.js";
import { disposeExit, hasHandoffMaterial, proposeExit } from "../../src/kernel/loop/exit-gate.js";
import { makeKernelInput, makeKernelState } from "../../src/testing/kernel-fixtures.js";
import { deriveTerminatedBy } from "../../src/kernel/loop/terminate-reason.js";
import {
  transitionState,
  type KernelState,
  type ThoughtKernel,
} from "../../src/kernel/state/kernel-state.js";
import { makeStep } from "../../src/kernel/capabilities/sense/step-utils.js";
import { resolveCompletionStatus } from "../../src/kernel/state/completion-status.js";
import type { ReasoningStep } from "../../src/types/index.js";

const HANDOFF_MARKER = "The run stopped before it finished.";

/** TestLLM layer that records every prompt the harness sends. */
function recordingLLM(turns: TestTurn[]) {
  const prompts: string[] = [];
  const layer = Layer.effect(
    LLMService,
    Effect.gen(function* () {
      const base = yield* LLMService;
      return {
        ...base,
        complete: (req: Parameters<typeof base.complete>[0]) => {
          prompts.push(JSON.stringify(req.messages));
          return base.complete(req);
        },
      };
    }),
  ).pipe(Layer.provide(TestLLMServiceLayer(turns)));
  return { layer, prompts, handoffCalls: () => prompts.filter((p) => p.includes(HANDOFF_MARKER)).length };
}

const observation = (tool: string, content: string): ReasoningStep =>
  makeStep("observation", content, { observationResult: { success: true, toolName: tool } } as never);

const gateRecords = (s: KernelState) =>
  s.steps.flatMap((st) => (st.metadata?.exitGate ? [st.metadata.exitGate] : []));

const schemas = [{ name: "file-read", description: "read a file", parameters: [] }];
const INPUT = { task: "Read the values and report them", availableToolSchemas: schemas, allToolSchemas: schemas } as never;

/** Iteration plan: `plan[i]` decides what the kernel does on the (i+1)th call. */
function scripted(plan: ((s: KernelState) => KernelState)[], afterHint?: (s: KernelState) => KernelState): ThoughtKernel {
  return (state) => {
    const i = state.iteration;
    const next = { ...state, iteration: i + 1 } as KernelState;
    if (afterHint && state.pendingGuidance?.qualityGateHint) return Effect.succeed(afterHint(next));
    const step = plan[Math.min(i, plan.length - 1)]!;
    return Effect.succeed(step(next));
  };
}

const read = (content: string) => (s: KernelState): KernelState =>
  transitionState(s, {
    status: "thinking",
    toolsUsed: new Set([...s.toolsUsed, "file-read"]),
    steps: [...s.steps, observation("file-read", content)],
  });
const idle = (s: KernelState): KernelState =>
  transitionState(s, { status: "thinking", steps: [...s.steps, makeStep("thought", "hmm")] });
const say = (text: string) => (s: KernelState): KernelState =>
  transitionState(s, { status: "thinking", steps: [...s.steps, makeStep("thought", text)] });

type Guard = { guard: string; outcome: string; reason: string; metadata?: Record<string, unknown> };

const run = (kernel: ThoughtKernel, turns: TestTurn[], maxIterations = 10) => {
  const llm = recordingLLM(turns);
  const guards: Guard[] = [];
  return Effect.runPromise(
    Effect.gen(function* () {
      const bus = yield* EventBus;
      yield* bus.on("GuardFiredEmitted", (e) => Effect.sync(() => { guards.push(e); }));
      return yield* runKernel(kernel, INPUT, { maxIterations, strategy: "test", kernelType: "test" } as never);
    }).pipe(Effect.provide(Layer.merge(llm.layer, EventBusLive))),
  ).then((state) => ({ state, llm, guards }));
};

const exitGateEvents = (guards: readonly Guard[]) => guards.filter((g) => g.guard === "exit_gate");

const ANSWER =
  "The file reports value=4217 for the first reading and value=88 for the second reading, " +
  "taken directly from the two file reads above.";

describe("seam-exit-gate (a): soft exit with an outstanding item is denied once, then the model finishes", () => {
  it("stall while only raw tool output exists → deny-once naming it → model answers → completed", async () => {
    let hintSeen = "";
    const kernel = scripted([read("value=4217"), idle], (s) => {
      hintSeen = s.pendingGuidance?.qualityGateHint ?? "";
      return transitionState(s, {
        status: "done",
        output: ANSWER,
        steps: [...s.steps, makeStep("thought", ANSWER)],
        meta: { ...s.meta, terminatedBy: "final_answer" },
      });
    });
    const { state, llm } = await run(kernel, [{ text: "unused" }]);
    const [denied] = gateRecords(state);
    expect(denied?.gateDecision).toBe("deny-once");
    expect(denied?.proposedBy).toBe("stall_deliverable");
    expect(denied?.outstanding.join(" ")).toContain("only raw tool output exists");
    expect(hintSeen).toContain("only raw tool output exists"); // the guidance reached the model
    expect(state.output).toBe(ANSWER);
    expect(resolveCompletionStatus(state)).toBe("completed");
    expect(llm.handoffCalls()).toBe(0);
  });
});

describe("seam-exit-gate (b): the second soft exit hands off", () => {
  it("stall → deny-once → stall again → ONE handoff synthesis naming the unfinished item; partial, not success", async () => {
    const kernel = scripted([read("value=4217"), idle]);
    const { state, llm, guards } = await run(kernel, [{ text: "The value is 4217." }]);
    expect(gateRecords(state).map((r) => r.gateDecision)).toEqual(["deny-once", "handoff"]);
    // Event shape: one disposition per proposal + the synthesis record.
    expect(exitGateEvents(guards).map((g) => [g.outcome, g.reason, g.metadata?.gateDecision, g.metadata?.handoffSynthesis])).toEqual([
      ["block", "harness_deliverable", "deny-once", false],
      ["terminate", "harness_deliverable", "handoff", false],
      ["terminate", "handoff_synthesis", "handoff", true],
    ]);
    expect(state.output).toBe(
      "The value is 4217.\n\nUnfinished:\n- write the final answer from the gathered tool results (only raw tool output exists so far)",
    );
    expect(llm.handoffCalls()).toBe(1);
    expect(resolveCompletionStatus(state)).toBe("partial");
    expect(state.meta.deliverableDecision?.accepted).toBe(false);
    expect(state.meta.deliverableDecision?.exitGate).toEqual({
      proposedBy: "stall_deliverable",
      gateDecision: "handoff",
      outstanding: ["write the final answer from the gathered tool results (only raw tool output exists so far)"],
      handoffSynthesis: true,
    });
  });
});

describe("seam-exit-gate (c): the iteration cap hands off, never a bare error", () => {
  it("cap reached with evidence but no answer → handoff synthesis; terminatedBy stays max_iterations", async () => {
    let n = 0;
    const kernel = scripted([(s) => read(`row ${++n}: value=${n * 10}`)(s)]);
    const { state, llm } = await run(kernel, [{ text: "Rows 1-4 report values 10, 20, 30 and 40." }], 4);
    expect(state.iteration).toBe(4); // the cap is a hard bound: never extended
    expect(gateRecords(state)).toHaveLength(1);
    expect(gateRecords(state)[0]).toMatchObject({ proposedBy: "max_iterations", gateDecision: "handoff" });
    expect(state.status).toBe("done");
    expect(state.error ?? null).toBeNull();
    expect(state.output).toStartWith("Rows 1-4 report values 10, 20, 30 and 40.\n\nUnfinished:\n- ");
    expect(deriveTerminatedBy(state).terminatedBy).toBe("max_iterations");
    expect(resolveCompletionStatus(state)).toBe("partial");
    expect(llm.handoffCalls()).toBe(1);
  });
});

const STALE_DRAFT =
  "The configured value is UNKNOWN-PLACEHOLDER according to my earlier notes, and the secondary " +
  "reading is unavailable, so the report lists only that single placeholder value.";

describe("seam-exit-gate (d): exact-value run2 shape — reads return values, then a stall", () => {
  it("the pre-read draft is never shipped: deny-once names the newer reads, the handoff reflects the read values", async () => {
    const kernel = scripted([say(STALE_DRAFT), read("value=4217"), read("value2=88"), idle]);
    const { state, llm } = await run(kernel, [{ text: "The values are 4217 and 88." }]);
    const records = gateRecords(state);
    expect(records[0]?.gateDecision).toBe("deny-once");
    expect(records[0]?.outstanding.join(" ")).toContain("arrived after the current answer text was written");
    expect(records[1]?.gateDecision).toBe("handoff");
    expect(state.output).toContain("4217");
    expect(state.output).toContain("88");
    expect(state.output).not.toContain("UNKNOWN-PLACEHOLDER");
    // The stale draft is not offered to the synthesis when evidence exists.
    const handoffPrompt = llm.prompts.find((p) => p.includes(HANDOFF_MARKER)) ?? "";
    expect(handoffPrompt).toContain("value=4217");
    expect(handoffPrompt).not.toContain("UNKNOWN-PLACEHOLDER");
  });
});

const NARRATION =
  "Here's the call to read the readings file so I can compute the mean temperature. " +
  "Once the data comes back I can do the math. Shall I proceed with that plan for you?";

describe("seam-exit-gate (e): acting-turn narration is never the delivered output", () => {
  it("residual text of a tool-calling turn is flagged as narration; the delivered output is the handoff, not the narration", async () => {
    const narrationTurn = (s: KernelState): KernelState =>
      transitionState(s, {
        status: "thinking",
        toolsUsed: new Set([...s.toolsUsed, "file-read"]),
        steps: [
          ...s.steps,
          makeStep("thought", `${NARRATION}\nfile-read({"path":"readings.csv"})`, {
            assistantTurn: {
              disposition: "mixed",
              consumedSpans: [{ start: NARRATION.length + 1, end: NARRATION.length + 36 }],
              callIds: ["call-1"],
              deliverableText: NARRATION,
              source: "text",
              dialect: "pseudo-code",
            },
          } as never),
          observation("file-read", "hour,temp\n1,20.1\n2,20.86"),
        ],
      });
    const kernel = scripted([narrationTurn, idle]);
    const { state } = await run(kernel, [{ text: "The mean temperature is 20.48 degrees." }]);
    const records = gateRecords(state);
    expect(records[0]?.outstanding.join(" ")).toContain("narration around a tool call");
    expect(state.output).not.toContain("Shall I proceed");
    expect(state.output).toStartWith("The mean temperature is 20.48 degrees.");
  });
});

describe("seam-exit-gate (f): an accepted done never pays for a synthesis", () => {
  it("fresh model answer after the reads + stall → accept; zero handoff calls, the model's answer ships", async () => {
    const kernel = scripted([read("value=4217"), read("value2=88"), say(ANSWER), idle]);
    const { state, llm, guards } = await run(kernel, [{ text: "SHOULD-NOT-BE-USED" }]);
    expect(exitGateEvents(guards).map((g) => [g.metadata?.proposedBy, g.metadata?.gateDecision, g.metadata?.outstanding])).toEqual([
      ["stall_deliverable", "accept", []],
    ]);
    expect(gateRecords(state)).toHaveLength(0); // accept is event-only: no intervention step
    expect(llm.handoffCalls()).toBe(0);
    expect(state.output).toBe(ANSWER);
    expect(state.meta.deliverableDecision?.exitGate).toBeUndefined();
    expect(resolveCompletionStatus(state)).toBe("completed");
  });
});

// (g) Live repro 2026-11-03 (cogito:8b, Cortex chat "what is 17×23"): a soft
// guard fired before the model wrote any answer. The gate used to `accept` any
// no-material exit, so the run failed without the one "write the final answer"
// nudge a run with material would have got. The nudge needs room, not material;
// only the handoff synthesis needs material (with none it would invent one).
describe("seam-exit-gate (g): a soft exit with NO material is nudged once before its failure stands", () => {
  const LOOP_MSG = "Loop detected: same tool call repeated 2 times";
  const noAnswerState = (iteration: number) =>
    makeKernelState({ iteration, llmCalls: iteration, steps: [makeStep("thought", "hmm")] });
  const proposal = (kind: "soft" | "cap") => ({
    proposedBy: "loop_resolution" as const,
    kind,
    reason: "loop_graceful" as const,
    deliverable: sentinelDeliverable("no_substantive_output", LOOP_MSG),
    failure: { error: LOOP_MSG, stampReason: true },
  });
  const propose = (state: KernelState, kind: "soft" | "cap", maxIterations = 10) =>
    Effect.runPromise(
      proposeExit({ state, proposal: proposal(kind), input: makeKernelInput({ task: "What is 17 * 23?" }), maxIterations, taskId: "t" }),
    );

  it("disposeExit: the nudge is checked before material; no-material never hands off", () => {
    const base = { kind: "soft" as const, outstanding: ["write the final answer"], hasMaterial: false, deniedBefore: false, iteration: 2, llmCalls: 2, maxIterations: 10 };
    expect(disposeExit(base)).toBe("deny-once");
    expect(disposeExit({ ...base, deniedBefore: true })).toBe("accept");
    expect(disposeExit({ ...base, kind: "cap" })).toBe("accept");
    expect(disposeExit({ ...base, iteration: 9 })).toBe("accept");
    expect(disposeExit({ ...base, outstanding: [] })).toBe("accept");
    expect(disposeExit({ ...base, hasMaterial: true, deniedBefore: true })).toBe("handoff");
  });

  it("soft + no material + outstanding + room → deny-once naming the answer; second soft → accept with the guard's failure", async () => {
    const state = noAnswerState(2);
    expect(hasHandoffMaterial(state)).toBe(false);
    const first = await propose(state, "soft");
    expect(first.decision).toBe("deny-once");
    expect(first.state.status).toBe("thinking");
    expect(first.state.pendingGuidance?.qualityGateHint).toContain("write the final answer to the task");
    expect(gateRecords(first.state).map((r) => r.gateDecision)).toEqual(["deny-once"]);

    const second = await propose(transitionState(first.state, { iteration: 3, llmCalls: 3 }), "soft");
    expect(second.decision).toBe("accept");
    expect(second.state.status).toBe("failed");
    expect(second.state.error).toContain(LOOP_MSG);
    expect(second.state.error).toContain("Outstanding: write the final answer to the task");
    expect(second.state.meta.terminatedBy).toBe("loop_graceful");
  });

  it("a cap proposal, or no room for one more iteration, is never nudged", async () => {
    const cap = await propose(noAnswerState(2), "cap");
    expect(cap.decision).toBe("accept");
    expect(cap.state.status).toBe("failed");
    const noRoom = await propose(noAnswerState(9), "soft");
    expect(noRoom.decision).toBe("accept");
    expect(noRoom.state.status).toBe("failed");
  });
});
