// Run: bun test packages/reasoning/tests/kernel/seam-pending-batch.test.ts --timeout 20000
//
// The pending-batch rule (`kernel/loop/pending-batch.ts`). A think that emits
// tool calls leaves them pending for the next pass's act. Every run end
// between that think and that act used to discard the batch silently: the
// 2026-11-06 early-stop/redirect verdict lost a cap-time out-6.txt write
// (01M6RJ8PPFT2YCG6QPDPHTTYBX, 01M6RJAKMRK0NKA2ZP8YBFDQJC: 14 thinks = max 14)
// and a switching_exhausted report.md write (01M6RJS0XDX5YDS9TRXFRB6RQ1).
// Spike over 779 recorded runs: 21 such ends, 20 failed, 11 batches wrote a
// declared file the run still lacked.
//
// Pins:
//   (c) iteration cap, batch writes an outstanding deliverable: the batch runs
//       once (one act, no new think) through the real runKernel path;
//   (r) iteration cap, batch writes nothing outstanding: nothing runs, the
//       drop is recorded (intervention step + guard event);
//   (s) switching_exhausted (the 01M6RJS0X shape): the run ends done, the
//       batch is recorded dropped and never executed;
//   (e) RI early stop handed off by the gate (the pre-fa3e33b7b redirect
//       shape): same;
//   (p) a durable pause keeps its batch for the resume (no record);
//   (w) the terminal pipeline settles the batch before it reads the fences.
//
// RED-ON-CUT (shown during the mission, then restored):
//   - make `pendingBatchSettlement` return "dropped" for the cap case: (c) fails
//     (file-write never executes);
//   - return `state` unchanged on "dropped" in `settlePendingBatch`: (r), (s),
//     (e) fail (no record).
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TestLLMServiceLayer, type TestTurn } from "@reactive-agents/llm-provider";
import { EventBus, EventBusLive } from "@reactive-agents/core";
import { reactKernel } from "../../src/kernel/loop/react-kernel.js";
import { runPass } from "../../src/kernel/loop/run-pass.js";
import { mockToolServiceLayer } from "../../src/testing/tool-service-mock.js";
import { makeKernelState } from "../../src/testing/kernel-fixtures.js";
import { makeStep } from "../../src/kernel/capabilities/sense/step-utils.js";
import { makeObservationResult } from "../../src/kernel/utils/observation-helpers.js";
import { artifactProduced } from "../../src/kernel/capabilities/verify/post-conditions.js";
import { handleDispatcherEarlyStop } from "../../src/kernel/loop/iterate-early-stop-seam.js";
import { GUARD_TURN_OPERATIONS } from "../../src/kernel/loop/turn-guard-operations.js";
import { openTurnScope } from "../../src/kernel/loop/turn-operations.js";
import type { IterationCarrier, IterationConfig } from "../../src/kernel/loop/iterate-pass.js";
import { pendingBatchSettlement, settlePendingBatch } from "../../src/kernel/loop/pending-batch.js";
import type { KernelContext, KernelState, ThoughtKernel } from "../../src/kernel/state/kernel-state.js";
import type { ReasoningStep } from "../../src/types/index.js";

const OUT = "/nonexistent-ra-pending-batch/out.txt";
const READ = { name: "file-read", description: "read", parameters: [{ name: "path", type: "string", required: true }] };
const WRITE = {
  name: "file-write",
  description: "write",
  parameters: [{ name: "path", type: "string", required: true }, { name: "content", type: "string", required: true }],
};
const TASK = `Read notes.txt, then write the word hello to ${OUT}.`;

/** Guard events published during a run (`GuardFiredEmitted`). */
type GuardEvent = { readonly guard: string; readonly outcome: string; readonly reason: string; readonly metadata?: Record<string, unknown> };

async function runCapped(turns: TestTurn[], maxIterations: number) {
  const executed: string[] = [];
  const guards: GuardEvent[] = [];
  const tools = mockToolServiceLayer({
    execute: (req) => {
      executed.push(req.toolName);
      return Effect.succeed({ success: true, result: { ok: true } });
    },
  });
  const program = Effect.gen(function* () {
    const bus = yield* EventBus;
    yield* bus.subscribe((e) =>
      Effect.sync(() => {
        if (e._tag === "GuardFiredEmitted") guards.push(e);
      }),
    );
    return yield* runPass(
      reactKernel,
      { task: TASK, availableToolSchemas: [READ, WRITE] },
      { maxIterations, strategy: "reactive", kernelType: "react", taskId: "pending-batch" },
    );
  });
  const { state } = await Effect.runPromise(
    program.pipe(Effect.provide(Layer.mergeAll(TestLLMServiceLayer(turns), tools, EventBusLive))),
  );
  return { state, executed, guards };
}

const pendingRecord = (steps: readonly ReasoningStep[]) =>
  steps.filter((s) => s.metadata?.intervention?.actor === "pending-batch");

describe("(c)/(r) the iteration cap", () => {
  it("(c) a batch writing an outstanding deliverable runs once: one act, no new think", async () => {
    const { state, executed, guards } = await runCapped(
      [
        { toolCalls: [{ id: "r1", name: "file-read", args: { path: "notes.txt" } }] },
        { toolCalls: [{ id: "w1", name: "file-write", args: { path: OUT, content: "hello" } }] },
        { text: "FINAL ANSWER: should never be asked for" },
      ],
      2,
    );
    expect(executed).toEqual(["file-read", "file-write"]);
    expect(state.llmCalls).toBe(2);
    expect(state.meta.pendingNativeToolCalls).toBeUndefined();
    expect(state.steps.some((s) => s.type === "observation" && s.metadata?.observationResult?.toolName === "file-write")).toBe(true);
    expect(pendingRecord(state.steps)).toHaveLength(0);
    expect(guards.filter((g) => g.guard === "pending_batch")).toEqual([
      expect.objectContaining({ outcome: "pass", reason: "drained", metadata: { calls: [`file-write(${OUT})`], deliverables: [OUT] } }),
    ]);
  }, 20000);

  it("(r) a batch writing nothing outstanding does not run; the drop is recorded", async () => {
    const { state, executed, guards } = await runCapped(
      [
        { toolCalls: [{ id: "r1", name: "file-read", args: { path: "notes.txt" } }] },
        { text: "FINAL ANSWER: should never be asked for" },
      ],
      1,
    );
    expect(executed).toEqual([]);
    expect(state.llmCalls).toBe(1);
    const [record] = pendingRecord(state.steps);
    expect(record?.type).toBe("harness_signal");
    expect(record?.metadata?.intervention).toEqual(
      expect.objectContaining({ authorityClass: "deterministic", evidence: "not executed: file-read(notes.txt)" }),
    );
    expect(guards.filter((g) => g.guard === "pending_batch")).toEqual([
      expect.objectContaining({ outcome: "warn", reason: "dropped", metadata: expect.objectContaining({ calls: ["file-read(notes.txt)"] }) }),
    ]);
  }, 20000);
});

// ── Guard exits: the run already ended; the batch is recorded, never run ─────

const spyKernel = (): { kernel: ThoughtKernel; calls: () => number } => {
  let n = 0;
  return {
    kernel: (s) => Effect.sync(() => {
      n++;
      return s;
    }),
    calls: () => n,
  };
};

/** A post-think state: one validated read, a pending write of the outstanding deliverable. */
function pendingWriteState(meta: Partial<KernelState["meta"]>, extraSteps: readonly ReasoningStep[] = []): KernelState {
  const base = makeKernelState({ iteration: 4, status: "acting" });
  return makeKernelState({
    iteration: 4,
    status: "acting",
    steps: [
      makeStep("action", "file-read(notes.txt)", { toolCall: { id: "r1", name: "file-read", arguments: { path: "notes.txt" } } }),
      makeStep("observation", "notes: say hello", {
        toolCallId: "r1",
        observationResult: makeObservationResult("file-read", true, "notes: say hello"),
      }),
      // Handoff material: a model draft over the bar (the gate hands off only with material).
      makeStep(
        "thought",
        "The notes file says the greeting to record is hello. The single word hello is the content the output file must hold, nothing else.",
        {},
      ),
      ...extraSteps,
    ],
    meta: {
      ...base.meta,
      maxIterations: 14,
      postConditions: [artifactProduced(OUT)],
      pendingNativeToolCalls: [{ id: "w1", name: "file-write", arguments: { path: OUT, content: "hello" } }],
      ...meta,
    },
  });
}

async function settle(state: KernelState) {
  const spy = spyKernel();
  const settled = await Effect.runPromise(
    settlePendingBatch(state, {
      kernel: spy.kernel,
      context: {} as KernelContext,
      currentOptions: { maxIterations: 14, strategy: "reactive", taskId: "pending-batch" },
    }).pipe(Effect.provide(TestLLMServiceLayer([]))),
  );
  return { settled, kernelCalls: spy.calls() };
}

/** The gate's one deny-once already spent, so a second soft exit ends the run. */
const deniedOnce = (proposedBy: string, reason: string) =>
  makeStep("harness_signal", "exit gate: denied", {
    exitGate: { proposedBy, gateDecision: "deny-once", reason, outstanding: [`produce ${OUT}`] },
  });

describe("(s)/(e) guard exits", () => {
  it("(s) switching_exhausted: the run ends done and the pending write is recorded dropped", async () => {
    const carrier: IterationCarrier = {
      state: pendingWriteState(
        { terminatedBy: "dispatcher-strategy-switch", dispatchedStrategySwitch: { to: "plan-execute-reflect", reason: "loop" } },
        [deniedOnce("switching_exhausted", "switching_exhausted")],
      ),
      currentInput: { task: TASK, availableToolSchemas: [READ, WRITE] },
      currentOptions: { maxIterations: 14, strategy: "reactive", taskId: "pending-batch" },
      currentContext: {} as KernelContext,
      prevActionCount: 0, prevStepCount: 0, prevStepCountForLearn: 0, prevDecisionLogCountForLearn: 0,
      prevArtifactCount: 0, consecutiveStalled: 0, requiredToolRedirects: 0, requiredToolNudgeCount: 0,
      failureRecoveryRedirects: 0, switchCount: 0, triedStrategies: ["reactive"], autoCheckpointed: false,
      mutableScratchpad: new Map(),
    };
    const t = openTurnScope(carrier);
    const cfg = { options: { maxIterations: 14, strategy: "reactive" } } as IterationConfig;
    const signal = await Effect.runPromise(GUARD_TURN_OPERATIONS["dispatcher-strategy-switch"](t, cfg));
    expect(typeof signal === "object" ? signal.decision : signal).toBe("handoff");
    const ended = typeof signal === "object" ? signal.state : t.state;
    expect(ended.status).toBe("done");
    expect(pendingBatchSettlement(ended)).toBe("dropped");

    const { settled, kernelCalls } = await settle(ended);
    expect(kernelCalls).toBe(0);
    expect(settled.status).toBe("done");
    expect(pendingRecord(settled.steps).map((s) => s.metadata?.intervention?.evidence)).toEqual([
      `not executed: file-write(${OUT})`,
    ]);
  });

  it("(e) RI early stop handed off by the gate: same record, nothing runs", async () => {
    const denied = deniedOnce("dispatcher_early_stop", "dispatcher-early-stop");
    const state = pendingWriteState(
      { terminatedBy: "dispatcher-early-stop", evidenceGraceGiven: true, dispatcherEarlyStop: { reason: "tool-failure-redirect", iteration: 4 } },
      [denied],
    );
    const input = { task: TASK, availableToolSchemas: [READ, WRITE] };
    const { state: ended, signal } = await Effect.runPromise(
      handleDispatcherEarlyStop({ state, input, effectiveInput: input, currentInput: input, currentOptions: { maxIterations: 14, strategy: "reactive" } }),
    );
    expect(signal === "continue" ? signal : signal.decision).toBe("handoff");
    expect(ended.meta.terminatedBy).toBe("harness_deliverable");

    const { settled, kernelCalls } = await settle(ended);
    expect(kernelCalls).toBe(0);
    expect(pendingRecord(settled.steps)).toHaveLength(1);
    expect(settled.steps[settled.steps.length - 1]!.content).toBe(
      `pending tool batch not executed (run ended by harness_deliverable): file-write(${OUT})`,
    );
  });
});

describe("(p)/(w) boundaries", () => {
  it("(p) a durable pause keeps its batch for the resume: no record, nothing runs", async () => {
    const paused = pendingWriteState({ terminatedBy: "awaiting-approval" });
    expect(pendingBatchSettlement(paused)).toBe("paused");
    const { settled, kernelCalls } = await settle(paused);
    expect(kernelCalls).toBe(0);
    expect(settled).toBe(paused);
  });

  it("(p) the cap drains only the acting state: a finished run with the same batch is dropped", () => {
    expect(pendingBatchSettlement(pendingWriteState({}))).toBe("drained");
    expect(pendingBatchSettlement({ ...pendingWriteState({}), status: "done" })).toBe("dropped");
    expect(pendingBatchSettlement(makeKernelState({ status: "acting" }))).toBe("none");
  });

  it("(w) the pipeline entry settles the batch before it reads the fences", () => {
    const src = readFileSync(join(import.meta.dir, "../../src/kernel/loop/terminal-pipeline.ts"), "utf8");
    const body = src.slice(src.indexOf("export function runKernelTerminalPipeline("));
    const settleAt = body.indexOf("settlePendingBatch(");
    expect(settleAt).toBeGreaterThan(0);
    expect(settleAt).toBeLessThan(body.indexOf("terminalFences("));
    expect(body.indexOf("terminalFences(settled)")).toBeGreaterThan(0);
  });
});
