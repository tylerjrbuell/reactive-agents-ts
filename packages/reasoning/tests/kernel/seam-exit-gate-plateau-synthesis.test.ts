// Run: bun test packages/reasoning/tests/kernel/seam-exit-gate-plateau-synthesis.test.ts --timeout 20000
//
// Recorded Cortex run 01M73FK911EPZWMJAGSFZ7FPNB (mimo-v2.6, maxIterations 10,
// "explore analytics for my docs site"): the model gathered for 8 iterations,
// then `low_delta_guard` proposed an exit right after the think of iteration 8
// (llmCalls 9). The exit gate's room test read `llmCalls < maxIterations - 1`,
// so it saw no room and handed the run to harness synthesis without the one
// "write the final answer" turn. The runner loop runs while
// `llmCalls < maxIterations`, so one more think DID fit.
//
// Fixed: the gate's LLM-call room matches the loop bound. The plateau now gets
// one ANSWER TURN (deny-once guidance; owner decision 2026-11-10: that one call
// ships with no tools); a model that answers ends model-authored, a model that
// still writes no answer ends failed with its evidence attached raw — the
// harness never writes the answer.
//
// The scripted kernel mirrors the real two-pass turn: a think pass (llmCalls+1,
// status acting) and an act pass (action + observation, iteration+1).
import { describe, expect, it } from "bun:test";
import { Effect, Layer } from "effect";
import { EventBus, EventBusLive } from "@reactive-agents/core";
import { LLMService, TestLLMServiceLayer, type TestTurn } from "@reactive-agents/llm-provider";
import { runKernel } from "../../src/kernel/loop/runner.js";
import { disposeExit } from "../../src/kernel/loop/exit-gate.js";
import { transitionState, type KernelState, type ThoughtKernel } from "../../src/kernel/state/kernel-state.js";
import { makeStep } from "../../src/kernel/capabilities/sense/step-utils.js";
import { resolveCompletionStatus } from "../../src/kernel/state/completion-status.js";
import { kernelTerminalMetadata } from "../../src/strategies/substrate/strategy-run.js";

const HANDOFF_MARKER = "The run stopped before it finished.";
const MAX = 10;
/** Tokens per pass while the model is still producing (well above any tier's low-delta threshold). */
const BUSY_TOKENS = 5000;
/** Last iteration whose passes still add tokens: the plateau starts with the act pass of iteration 7. */
const LAST_BUSY_THINK = 7;

const schemas = [{ name: "get-stats", description: "read site stats", parameters: [] }];
const INPUT = { task: "Help me explore analytics for my docs site", availableToolSchemas: schemas, allToolSchemas: schemas } as never;

const ANSWER =
  "Your docs site had 4,210 pageviews this month; the top pages are /quickstart (1,020) and " +
  "/reference (880), and most visitors arrive from search.";

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
        stream: (req: Parameters<typeof base.stream>[0]) => {
          prompts.push(JSON.stringify(req.messages));
          return base.stream(req);
        },
      };
    }),
  ).pipe(Layer.provide(TestLLMServiceLayer(turns)));
  return {
    layer,
    handoffCalls: () => prompts.filter((p) => p.includes(HANDOFF_MARKER)).length,
    /** Every LLM call the harness made (the scripted kernel makes none of its own). */
    calls: () => prompts.length,
  };
}

/** A think that only queues a gather (the plateau: no new tokens after LAST_BUSY_THINK). */
const thinkGather = (s: KernelState): KernelState =>
  transitionState(s, {
    status: "acting",
    llmCalls: (s.llmCalls ?? 0) + 1,
    tokens: s.tokens + (s.iteration <= LAST_BUSY_THINK ? BUSY_TOKENS : 0),
    pendingGuidance: undefined,
  });

/** The act pass: one new gather result, then the next iteration. */
const actGather = (s: KernelState): KernelState =>
  transitionState(s, {
    status: "thinking",
    iteration: s.iteration + 1,
    tokens: s.tokens + (s.iteration < LAST_BUSY_THINK ? BUSY_TOKENS : 0),
    toolsUsed: new Set([...s.toolsUsed, "get-stats"]),
    steps: [
      ...s.steps,
      makeStep("action", `get-stats({"page":${s.iteration}})`, { toolUsed: "get-stats" } as never),
      makeStep("observation", `page ${s.iteration}: ${100 + s.iteration * 37} views`, {
        observationResult: { success: true, toolName: "get-stats" },
      } as never),
    ],
  });

/** The model's own answer, written on the turn after the gate's guidance. */
const answer = (s: KernelState): KernelState =>
  transitionState(s, {
    status: "done",
    llmCalls: (s.llmCalls ?? 0) + 1,
    output: ANSWER,
    steps: [...s.steps, makeStep("thought", ANSWER)],
    meta: { ...s.meta, terminatedBy: "final_answer" },
  });

function plateauKernel(onHint: (s: KernelState) => KernelState, seen: { hint: string }): ThoughtKernel {
  return (state) => {
    if (state.status === "acting") return Effect.succeed(actGather(state));
    const hint = state.pendingGuidance?.qualityGateHint;
    if (hint !== undefined) {
      seen.hint = hint;
      return Effect.succeed(onHint(state));
    }
    return Effect.succeed(thinkGather(state));
  };
}

type Guard = { guard: string; outcome: string; reason: string; metadata?: Record<string, unknown> };

const run = (kernel: ThoughtKernel, turns: TestTurn[]) => {
  const llm = recordingLLM(turns);
  const guards: Guard[] = [];
  return Effect.runPromise(
    Effect.gen(function* () {
      const bus = yield* EventBus;
      yield* bus.on("GuardFiredEmitted", (e) => Effect.sync(() => { guards.push(e); }));
      return yield* runKernel(kernel, INPUT, { maxIterations: MAX, strategy: "test", kernelType: "test" } as never);
    }).pipe(Effect.provide(Layer.merge(llm.layer, EventBusLive))),
  ).then((state) => ({ state, llm, guards }));
};

const gateRecords = (s: KernelState) =>
  s.steps.flatMap((st) => (st.metadata?.exitGate ? [st.metadata.exitGate] : []));

describe("seam-exit-gate plateau: one synthesis turn before the handoff", () => {
  it("disposeExit: room for one more LLM call is the runner's own bound (llmCalls < maxIterations)", () => {
    const base = { kind: "soft" as const, outstanding: ["write the final answer"], hasMaterial: true, deniedBefore: false, maxIterations: MAX };
    // The recorded shape: guard after the think of iteration 8, 9 LLM calls made.
    expect(disposeExit({ ...base, iteration: 8, llmCalls: 9 })).toBe("deny-once");
    // No call left: the loop would not run another think.
    expect(disposeExit({ ...base, iteration: 8, llmCalls: MAX })).toBe("handoff");
  });

  it("low-delta plateau with gathered evidence → deny-once guidance → the model answers → model-authored, completed", async () => {
    const seen = { hint: "" };
    const { state, llm, guards } = await run(plateauKernel(answer, seen), [{ text: "SHOULD-NOT-BE-USED" }]);
    const lowDelta = guards.filter((g) => g.guard === "low_delta_guard");
    expect(lowDelta.map((g) => g.outcome)).toEqual(["block"]);
    expect(gateRecords(state).map((r) => [r.proposedBy, r.gateDecision])).toEqual([["low_delta_guard", "deny-once"]]);
    expect(seen.hint).toContain("write the final answer from the gathered tool results");
    expect(state.output).toBe(ANSWER);
    expect(state.meta.terminatedBy).toBe("final_answer");
    expect(state.meta.deliverableDecision?.exitGate).toBeUndefined();
    expect(resolveCompletionStatus(state)).toBe("completed");
    expect(state.llmCalls).toBe(MAX); // the synthesis turn is the one remaining call, never an extra one
    expect(llm.handoffCalls()).toBe(0);
  });

  it("the deny-once is an ANSWER TURN: the record carries the LLM-call count its tool-free call runs at", async () => {
    const seen = { hint: "" };
    const { state } = await run(plateauKernel(answer, seen), [{ text: "SHOULD-NOT-BE-USED" }]);
    expect(gateRecords(state)[0]?.answerTurnAt).toBe(MAX - 1);
    expect(seen.hint).toContain("Tools are not available on this turn");
  });

  // Owner decision 2026-11-10: the harness never writes the answer. A model
  // that writes nothing usable on its answer turn ends as an honest failure
  // with the gathered evidence attached raw — no harness LLM call, no
  // harness-authored deliverable.
  it("(b) a model that writes no answer on the answer turn fails honestly; evidence attached raw; no harness synthesis call", async () => {
    const seen = { hint: "" };
    const { state, llm, guards } = await run(plateauKernel(thinkGather, seen), [{ text: "Pageviews: 4,210 across the gathered pages." }]);
    expect(seen.hint).toContain("write the final answer");
    expect(gateRecords(state).map((r) => r.gateDecision)).toEqual(["deny-once", "handoff"]);
    expect(llm.handoffCalls()).toBe(0);
    expect(llm.calls()).toBe(0);
    expect(state.status).toBe("failed");
    expect(state.output ?? null).toBeNull();
    expect(state.meta.terminatedBy).toBe("low_delta_guard");
    expect(state.meta.harnessAuthoredOutput).toBeUndefined();
    expect(state.meta.deliverableDecision?.why).not.toBe("handoff-synthesis");
    expect(state.error).toContain("before the model wrote a final answer");
    expect(state.error).toContain("Outstanding: write the final answer from the gathered tool results");
    expect(resolveCompletionStatus(state)).not.toBe("completed");
    expect(guards.some((g) => g.reason === "handoff_synthesis")).toBe(false);
    // The evidence rides the result raw, never written up as an answer.
    const ext = kernelTerminalMetadata(state, state.ledger ?? []).extensions as Record<string, unknown>;
    const evidence = ext.unfinishedEvidence as readonly { toolName: string; content: string }[];
    expect(evidence.length).toBeGreaterThan(0);
    expect(evidence.every((e) => e.toolName === "get-stats")).toBe(true);
    expect(evidence.map((e) => e.content).join("\n")).toContain("page 1: 137 views");
  });

  it("a clean model answer carries no unfinished evidence", async () => {
    const seen = { hint: "" };
    const { state } = await run(plateauKernel(answer, seen), [{ text: "SHOULD-NOT-BE-USED" }]);
    const ext = kernelTerminalMetadata(state, state.ledger ?? []).extensions as Record<string, unknown>;
    expect(ext.unfinishedEvidence).toBeUndefined();
  });
});
