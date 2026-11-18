// File: tests/kernel/loop/user-stop-honest.test.ts
/**
 * A person's stop request is reported honestly, and leaves a resumable state.
 *
 * Zero-token: scripted ThoughtKernels drive the REAL runner (RunController
 * `stop`), the real terminate() gateway, the real strategy result mint.
 *   1. `ctl.stop` -> the kernel writes its own final checkpoint (iteration + 1,
 *      the live state, resumable), through the same rail as the loop stop;
 *   2. the stop terminal is `stop_requested`, an honest PARTIAL (never completed)
 *      that keeps the answer so far, even with unmet post-conditions;
 *   3. the mint reports status partial + outstanding `stopped_by_request`, and
 *      the reconciled outcome is not a success (authority `user-stop`);
 *   4. the stop record builds for non-loop reasons and from a serialized state.
 */
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { modelSynthesisDeliverable } from "@reactive-agents/core";
import { rootContext, type RunControllerLike } from "@reactive-agents/core";
import { bindRun, runControllerSlot, withRunScope } from "@reactive-agents/core/internal/run-scope";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import * as reasoning from "../../../src/index.js";
import { runKernel } from "../../../src/kernel/loop/runner.js";
import { terminate } from "../../../src/kernel/loop/terminate.js";
import {
  buildLoopStopRecord,
  buildStopRecordFromSerialized,
} from "../../../src/kernel/loop/loop-stop.js";
import { isUserStopReason } from "../../../src/kernel/loop/terminate-reason.js";
import { resolveCompletionStatus } from "../../../src/kernel/state/completion-status.js";
import { deserializeKernelState, serializeKernelState } from "../../../src/kernel/state/kernel-codec.js";
import { recordChecklistItems } from "../../../src/kernel/ledger/emit.js";
import { finalizeStrategyResult } from "../../../src/kernel/capabilities/sense/finalize-result.js";
import { buildRunEnvelope, provideTestEnvelope } from "../../../src/kernel/envelope/run-envelope.js";
import { toolCalled } from "../../../src/kernel/capabilities/verify/post-conditions.js";
import { initialKernelState, transitionState, type KernelRunOptions, type KernelState, type ThoughtKernel } from "../../../src/kernel/state/kernel-state.js";
import { makeStep } from "../../../src/kernel/capabilities/sense/step-utils.js";
import { makeObservationResult } from "../../../src/kernel/utils/observation-helpers.js";
import type { RunLedger } from "../../../src/kernel/ledger/run-ledger.js";

const OPTIONS: KernelRunOptions = { maxIterations: 20, strategy: "reactive", kernelType: "react", taskId: "user-stop" };

let seq = 0;
/** Each iteration: one successful read-file round (so there is work to keep). */
const readingKernel: ThoughtKernel = (state) =>
  Effect.sync(() => {
    const id = `c${++seq}`;
    return transitionState(state, {
      status: "thinking",
      iteration: state.iteration + 1,
      steps: [
        ...state.steps,
        makeStep("action", JSON.stringify({ tool: "read-file", input: `{"path":"f${seq}"}` }), {
          toolCall: { id, name: "read-file", arguments: { path: `f${seq}` } },
        }),
        makeStep("observation", `contents ${seq}`, {
          toolCallId: id,
          observationResult: makeObservationResult("read-file", true, `contents ${seq}`),
        }),
      ],
    });
  });

const runStopped = (stopAtPoll: number, hard = false) => {
  const rows: { serialized: string; iteration: number }[] = [];
  let polls = 0;
  const ctl: RunControllerLike = {
    checkpoint: () =>
      Promise.resolve(++polls >= stopAtPoll ? { stop: true as const, ...(hard ? { terminate: true } : {}) } : undefined),
    onCheckpoint: (serialized, iteration) => {
      rows.push({ serialized, iteration });
    },
  };
  return Effect.runPromise(
    runKernel(readingKernel, { task: "read the files" }, OPTIONS).pipe(
      withRunScope(rootContext("user-stop", "agent"), bindRun(runControllerSlot, ctl)),
      Effect.provide(TestLLMServiceLayer()),
    ) as Effect.Effect<KernelState, never, never>,
  ).then((state) => ({ state, rows }));
};

describe("ctl.stop: the kernel writes its own final checkpoint", () => {
  it("writes the live pass-boundary state at iteration + 1 (wins latestCheckpoint), resumable", async () => {
    const { state, rows } = await runStopped(3);
    expect(state.meta.terminatedBy).toBe("stop_requested");
    const last = rows[rows.length - 1]!;
    const live = deserializeKernelState(last.serialized);
    // Boundary rows are written per finished iteration at their own iteration;
    // the stop pass has none, so the stop row is the newest and is one past.
    expect(last.iteration).toBe(live.iteration + 1);
    expect(rows.map((r) => r.iteration)).toEqual([0, 1, 3]);
    // The state is the LIVE one (not the terminal): continuing it is a plain resume.
    expect(live.status).not.toBe("done");
    expect(live.meta.terminatedBy).toBeUndefined();
    expect(live.steps.length).toBe(state.steps.length);
  });

  it("a hard terminate writes it too (same rail, terminate_requested)", async () => {
    const { state, rows } = await runStopped(2, true);
    expect(state.meta.terminatedBy).toBe("terminate_requested");
    expect(rows[rows.length - 1]!.iteration).toBe(deserializeKernelState(rows[rows.length - 1]!.serialized).iteration + 1);
  });

  it("a throwing onCheckpoint never kills the stop", async () => {
    const ctl: RunControllerLike = {
      checkpoint: () => Promise.resolve({ stop: true as const }),
      onCheckpoint: () => {
        throw new Error("store down");
      },
    };
    const state = await Effect.runPromise(
      runKernel(readingKernel, { task: "t" }, OPTIONS).pipe(
        withRunScope(rootContext("user-stop-throw", "agent"), bindRun(runControllerSlot, ctl)),
        Effect.provide(TestLLMServiceLayer()),
      ) as Effect.Effect<KernelState, never, never>,
    );
    expect(state.meta.terminatedBy).toBe("stop_requested");
  });
});

describe("a stop is an honest partial in the kernel", () => {
  it("isUserStopReason names exactly the two request reasons", () => {
    expect(isUserStopReason("stop_requested")).toBe(true);
    expect(isUserStopReason("terminate_requested")).toBe(true);
    for (const other of ["end_turn", "loop_graceful", "budget_exceeded", undefined, "stop"]) {
      expect(isUserStopReason(other)).toBe(false);
    }
  });

  it("resolveCompletionStatus: a done stop is partial, never completed", () => {
    const base = initialKernelState({ strategy: "reactive", kernelType: "react", maxIterations: 5 });
    const done = transitionState(base, { status: "done", meta: { ...base.meta, terminatedBy: "stop_requested" } });
    expect(resolveCompletionStatus(done)).toBe("partial");
    const ended = transitionState(base, { status: "done", meta: { ...base.meta, terminatedBy: "end_turn" } });
    expect(resolveCompletionStatus(ended)).toBe("completed");
  });

  it("terminate(): unmet post-conditions do not demote a stop to failed; the answer so far survives", () => {
    const base = initialKernelState({ strategy: "reactive", kernelType: "react", maxIterations: 5 });
    const state = { ...base, meta: { ...base.meta, postConditions: [toolCalled("file-write")] } };
    const stopped = terminate(state, {
      reason: "stop_requested",
      deliverable: modelSynthesisDeliverable({ type: "thought", content: "Read two of three files so far.", iteration: 0 }),
    });
    expect(stopped.status).toBe("done");
    expect(stopped.output).toBe("Read two of three files so far.");
    expect(stopped.meta.terminatedBy).toBe("stop_requested");
    // Control: the same state ended by any other forced reason IS demoted.
    expect(
      terminate(state, {
        reason: "harness_deliverable",
        deliverable: modelSynthesisDeliverable({ type: "thought", content: "x", iteration: 0 }),
      }).status,
    ).toBe("failed");
  });
});

describe("the mint reports a stop as partial, not success", () => {
  const params = {
    strategy: "reactive" as const,
    steps: [],
    output: "Read two of three files so far.",
    status: "completed" as const,
    start: 0,
    totalTokens: 10,
    totalCost: 0,
    taskId: "user-stop-mint",
    requiredTools: [] as readonly string[],
    runLedger: [] as RunLedger,
    repairCapabilities: { perIteration: true },
  };

  it("kernel stop: partial + outstanding stopped_by_request + outcome not success, answer kept", async () => {
    const r = await Effect.runPromise(
      provideTestEnvelope(finalizeStrategyResult({ ...params, kernelMeta: { terminatedBy: "stop_requested" } })),
    );
    expect(r.status).toBe("partial");
    expect(r.output).toBe("Read two of three files so far.");
    const md = r.metadata as { outstandingCriteria?: readonly string[]; verificationWarning?: string; extensions?: Record<string, unknown> };
    expect(md.outstandingCriteria).toEqual([reasoning.USER_STOP_CRITERION]);
    expect(md.verificationWarning).toContain("stopped on request");
    const outcome = md.extensions?.["terminalOutcome"] as { status: string; success: boolean; terminatedBy: string; authority: string; outstanding: string[] };
    expect(outcome.status).toBe("partial");
    expect(outcome.success).toBe(false);
    expect(outcome.terminatedBy).toBe("stop_requested");
    expect(outcome.authority).toBe("user-stop");
    expect(outcome.outstanding).toContain("stopped_by_request");
  });

  it("a relayed stop (raw reason on extraMetadata, no kernelMeta) is judged the same", async () => {
    const r = await Effect.runPromise(
      provideTestEnvelope(
        finalizeStrategyResult({
          ...params,
          strategy: "adaptive",
          extraMetadata: { terminatedBy: "end_turn", rawTerminatedBy: "stop_requested" },
        }),
      ),
    );
    expect(r.status).toBe("partial");
    expect((r.metadata as { outstandingCriteria?: readonly string[] }).outstandingCriteria).toEqual(["stopped_by_request"]);
  });

  // Audit 2026-11-18 polish 2: the user-stop coverage re-mint rebuilt from
  // `params` and dropped the earlier arms' cause. CUT: re-mint with
  // `...params` alone (no arm error / metadata) turns these red.
  const readStep = () => [
    makeStep("action", JSON.stringify({ tool: "read-file", input: '{"path":"a"}' }), {
      toolCall: { id: "s1", name: "read-file", arguments: { path: "a" } },
    }),
  ];

  it("empty-output stop keeps the GH #206 cause (what was attempted) on error", async () => {
    const r = await Effect.runPromise(
      provideTestEnvelope(
        finalizeStrategyResult({
          ...params,
          steps: readStep(),
          output: "",
          status: "failed",
          kernelMeta: { terminatedBy: "stop_requested" },
        }),
      ),
    );
    expect(r.status).toBe("failed");
    expect(r.error).toBeDefined();
    expect(r.error).toContain("stopped on request (stop_requested)");
    expect(r.error).not.toContain("within the available budget");
    const outcome = (r.metadata as { extensions?: Record<string, unknown> }).extensions?.["terminalOutcome"] as { authority: string };
    expect(outcome.authority).toBe("user-stop");
  });

  it("a stop on a fabrication-guard enforced run keeps the guard cause and the abstained terminal", async () => {
    const r = await Effect.runPromise(
      provideTestEnvelope(
        finalizeStrategyResult({
          ...params,
          requiredTools: ["web-search"],
          extraMetadata: { terminatedBy: "final_answer", rawTerminatedBy: "stop_requested" },
        }),
        buildRunEnvelope({ fabricationGuard: "block" }),
      ),
    );
    expect(r.status).toBe("failed");
    expect(r.error).toContain("grounding-on-required");
    expect((r.metadata as Record<string, unknown>)["terminatedBy"]).toBe("abstained");
  });

  it("control: an ordinary end_turn stays completed with nothing outstanding", async () => {
    const r = await Effect.runPromise(
      provideTestEnvelope(finalizeStrategyResult({ ...params, kernelMeta: { terminatedBy: "end_turn" } })),
    );
    expect(r.status).toBe("completed");
    expect((r.metadata as { outstandingCriteria?: readonly string[] }).outstandingCriteria).toBeUndefined();
  });
});

describe("the stop record is not loop-only", () => {
  const stateWithChecklist = () => {
    const base = initialKernelState({ strategy: "reactive", kernelType: "react", maxIterations: 5 });
    return transitionState(base, {
      iteration: 4,
      steps: [
        ...[1, 2, 3].flatMap((n) => [
          makeStep("action", JSON.stringify({ tool: "read-file", input: '{"path":"same"}' }), {
            toolCall: { id: `r${n}`, name: "read-file", arguments: { path: "same" } },
          }),
          makeStep("observation", "same contents", {
            toolCallId: `r${n}`,
            observationResult: makeObservationResult("read-file", true, "same contents"),
          }),
        ]),
      ],
      ledger: recordChecklistItems(base.ledger, [
        { iteration: 0, change: { op: "add", items: [{ id: "1", title: "write notes.md" }, { id: "2", title: "send summary" }] } },
      ]),
    });
  };

  it("a user stop carries the unfinished rows, tools done and iteration; no repeated-call finding", () => {
    const record = buildLoopStopRecord(stateWithChecklist(), { reason: "stop_requested" });
    expect(record.reason).toBe("stop_requested");
    expect(record.unfinished).toEqual(["write notes.md", "send summary"]);
    expect(record.toolsDone).toEqual([{ tool: "read-file", calls: 3 }]);
    expect(record.iteration).toBe(4);
    expect(record.repeatedCall).toBeUndefined();
    expect(record.repeatedTool).toBeUndefined();
  });

  it("control: the same state under a loop reason keeps the repeated-call finding", () => {
    const record = buildLoopStopRecord(stateWithChecklist(), { reason: "loop_graceful" });
    expect(record.repeatedTool).toBe("read-file");
  });

  it("builds from a serialized snapshot, and from an explicit run ledger", () => {
    const state = stateWithChecklist();
    const fromString = buildStopRecordFromSerialized(serializeKernelState(state), { reason: "budget_exceeded" });
    expect(fromString?.unfinished).toEqual(["write notes.md", "send summary"]);
    const base = initialKernelState({ strategy: "reactive", kernelType: "react", maxIterations: 5 });
    const runLedger = recordChecklistItems(base.ledger, [{ iteration: 0, change: { op: "add", items: [{ id: "9", title: "plan step" }] } }]);
    expect(buildLoopStopRecord(base, { reason: "stop_requested", ledger: runLedger }).unfinished).toEqual(["plan step"]);
    expect(buildStopRecordFromSerialized("not a state")).toBeUndefined();
  });

  it("is on the package barrel", () => {
    expect(typeof reasoning.buildLoopStopRecord).toBe("function");
    expect(typeof reasoning.buildStopRecordFromSerialized).toBe("function");
    expect(typeof reasoning.isUserStopReason).toBe("function");
  });
});
