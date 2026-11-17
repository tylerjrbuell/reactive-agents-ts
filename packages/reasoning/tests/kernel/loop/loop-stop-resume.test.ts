// File: tests/kernel/loop/loop-stop-resume.test.ts
/**
 * A loop-guard stop is resumable (`kernel/loop/loop-stop.ts`).
 *
 * Zero-token: scripted ThoughtKernels drive the REAL runner, so the real loop
 * detector, exit gate, terminal pipeline and checkpoint rail run. Proves:
 *   1. a loop stop leaves a typed `meta.loopStop` record and a FINAL checkpoint
 *      (iteration + 1) carrying it;
 *   2. `resumeFromStop` resets the guard epoch, status, terminal meta and
 *      contributes corrective guidance that renders into the next prompt;
 *   3. a resumed run re-runs no completed step, does not re-trip on the same
 *      repeated call, and ends with a deliverable.
 */
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { rootContext, type RunControllerLike } from "@reactive-agents/core";
import { bindRun, runControllerSlot, withRunScope } from "@reactive-agents/core/internal/run-scope";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { runKernel } from "../../../src/kernel/loop/runner.js";
import { initialKernelState, transitionState, type KernelRunOptions, type KernelState, type ThoughtKernel } from "../../../src/kernel/state/kernel-state.js";
import { deserializeKernelState } from "../../../src/kernel/state/kernel-codec.js";
import { renderGuidance } from "../../../src/kernel/state/guidance-channel.js";
import { makeStep } from "../../../src/kernel/capabilities/sense/step-utils.js";
import { makeObservationResult } from "../../../src/kernel/utils/observation-helpers.js";
import { recordChecklistItems } from "../../../src/kernel/ledger/emit.js";
import { detectLoopPattern } from "../../../src/kernel/capabilities/reflect/loop-detector.js";
import { loopGuidanceCycles, LOOP_GUIDANCE_ACTOR } from "../../../src/kernel/loop/runner-helpers/loop-guidance.js";
import {
  buildLoopStopRecord,
  isLoopStopped,
  loopResumeGuidanceText,
  resumeFromStop,
  resumeMaxIterations,
} from "../../../src/kernel/loop/loop-stop.js";
import type { ReasoningStep } from "../../../src/types/index.js";

const OPTIONS: KernelRunOptions = {
  maxIterations: 20,
  strategy: "reactive",
  kernelType: "react",
  taskId: "loop-stop-resume",
  loopDetection: { maxSameToolCalls: 3, guidanceCycles: 0 },
};
const TASK = "Find the release date and write it to notes.md";
const SEARCH_ARGS = { q: "release date" };

let callSeq = 0;
/** One scripted tool round: the action step plus the observation that answers it. */
function toolRound(name: string, args: Record<string, unknown>, success: boolean, content: string): readonly ReasoningStep[] {
  const id = `call-${++callSeq}`;
  return [
    makeStep("action", JSON.stringify({ tool: name, input: JSON.stringify(args) }), { toolCall: { id, name, arguments: args } }),
    makeStep("observation", content, {
      toolCallId: id,
      observationResult: makeObservationResult(name, success, content),
    }),
  ];
}

/** The call the run keeps repeating: it succeeds with the same hits every time, so the loop detector (not tool-health) stops it. */
const searchRound = (): readonly ReasoningStep[] =>
  toolRound("web-search", SEARCH_ARGS, true, "3 hits: release notes, changelog, blog post");

const append = (state: KernelState, steps: readonly ReasoningStep[]): KernelState =>
  transitionState(state, { status: "thinking", iteration: state.iteration + 1, steps: [...state.steps, ...steps] });

/** Phase 1: one good read, then the same failing search until the loop guard stops it. */
const dyingKernel: ThoughtKernel = (state) =>
  Effect.succeed(
    state.iteration === 0
      ? append(
          transitionState(state, {
            ledger: recordChecklistItems(state.ledger, [
              { iteration: 0, change: { op: "add", items: [{ id: "1", title: "write notes.md" }] } },
            ]),
          }),
          toolRound("read-file", { path: "a.txt" }, true, "a.txt contents: v2.0 ships on 2026-03-01"),
        )
      : append(state, searchRound()),
  );

/** Phase 2 kernel: records what it sees, repeats the old call ONCE, then delivers. */
function resumedKernel(seen: { guidance: string[]; stepsAtFirstCall: number; ran: string[] }): ThoughtKernel {
  return (state) =>
    Effect.sync(() => {
      seen.guidance.push(renderGuidance(state.pendingGuidance).lines.map((l) => l.line).join("\n"));
      if (seen.guidance.length === 1) seen.stepsAtFirstCall = state.steps.length;
      if (seen.guidance.length === 1) {
        seen.ran.push("web-search");
        return append(state, searchRound());
      }
      seen.ran.push("write-file");
      return transitionState(
        append(state, toolRound("write-file", { path: "notes.md" }, true, "wrote notes.md")),
        { status: "done", output: "Release date: 2026-03-01 (from a.txt), written to notes.md." },
      );
    });
}

const run = (kernel: ThoughtKernel, input: Parameters<typeof runKernel>[1], controller: RunControllerLike) =>
  Effect.runPromise(
    runKernel(kernel, input, OPTIONS).pipe(
      withRunScope(rootContext("loop-stop-resume", "agent"), bindRun(runControllerSlot, controller)),
      Effect.provide(TestLLMServiceLayer()),
    ) as Effect.Effect<KernelState, never, never>,
  );

const recordingController = (rows: { serialized: string; iteration: number }[]): RunControllerLike => ({
  checkpoint: () => Promise.resolve(undefined),
  onCheckpoint: (serialized, iteration) => {
    rows.push({ serialized, iteration });
  },
});

describe("loop stop leaves a typed record and a final checkpoint", () => {
  it("stamps meta.loopStop and writes the terminal state at iteration + 1", async () => {
    const rows: { serialized: string; iteration: number }[] = [];
    const stopped = await run(dyingKernel, { task: TASK }, recordingController(rows));

    expect(isLoopStopped(stopped)).toBe(true);
    const record = stopped.meta.loopStop;
    expect(record).toBeDefined();
    expect(record?.pattern?.id).toBe("a");
    expect(record?.repeatedTool).toBe("web-search");
    expect(record?.toolsDone).toEqual([
      { tool: "read-file", calls: 1 },
      { tool: "web-search", calls: 4 },
    ]);
    expect(record?.unfinished).toEqual(["write notes.md"]);
    expect(record?.iteration).toBe(stopped.iteration);

    // The LAST checkpoint row is the final state: distinct ordering key, record intact, codec round-trips.
    const last = rows[rows.length - 1]!;
    expect(last.iteration).toBe(stopped.iteration + 1);
    const restored = deserializeKernelState(last.serialized);
    expect(restored.meta.loopStop).toEqual(record);
    expect(restored.steps.length).toBe(stopped.steps.length);
  });

  it("a run that does not loop writes no stop record", async () => {
    const rows: { serialized: string; iteration: number }[] = [];
    const finishing: ThoughtKernel = (state) =>
      Effect.succeed(transitionState(state, { status: "done", iteration: state.iteration + 1, output: "42" }));
    const done = await run(finishing, { task: "what is 6*7" }, recordingController(rows));
    expect(done.meta.loopStop).toBeUndefined();
    expect(rows.every((r) => !deserializeKernelState(r.serialized).meta.loopStop)).toBe(true);
  });
});

describe("resumeFromStop", () => {
  it("is the identity on a state that did not end by a loop guard", () => {
    const live = initialKernelState(OPTIONS);
    expect(resumeFromStop(live)).toBe(live);
  });

  it("clears terminal state, resets the guard epoch and contributes corrective guidance", async () => {
    const stopped = await run(dyingKernel, { task: TASK }, recordingController([]));
    const resumed = resumeFromStop(stopped, { goal: TASK });

    expect(resumed.status).toBe("thinking");
    expect(resumed.output).toBeNull();
    expect(resumed.error).toBeNull();
    expect(resumed.meta.terminatedBy).toBeUndefined();
    expect(resumed.meta.loopStop).toBeUndefined();
    expect(isLoopStopped(resumed)).toBe(false);
    // history carried verbatim (plus the one epoch marker): nothing is re-run.
    expect(resumed.steps.slice(0, stopped.steps.length)).toEqual([...stopped.steps]);
    expect(resumed.steps.length).toBe(stopped.steps.length + 1);

    const text = renderGuidance(resumed.pendingGuidance).lines.map((l) => l.line).join("\n");
    expect(text).toContain("loop detection");
    expect(text).toContain("web-search");
    expect(text).toContain("read-file x1, web-search x4");
    expect(text).toContain("write notes.md");
    expect(text).toContain(TASK);
    expect(text).toContain("do not redo");
  });

  it("old guard steps stop counting: spent guidance cycles reset, the detector window restarts", () => {
    const guided = makeStep("harness_signal", "warning", {
      intervention: { actor: LOOP_GUIDANCE_ACTOR, authorityClass: "deterministic", evidence: "e", whatChanged: "w", iter: 1 },
    });
    const looped = [
      ...toolRound("web-search", SEARCH_ARGS, false, "Error: x"),
      guided,
      ...toolRound("web-search", SEARCH_ARGS, false, "Error: x"),
      guided,
      ...toolRound("web-search", SEARCH_ARGS, false, "Error: x"),
    ];
    expect(loopGuidanceCycles(looped)).toBeGreaterThan(0);
    expect(detectLoopPattern(looped, 3, 3, 3)?.pattern.id).toBe("a");

    const stopped = transitionState(initialKernelState(OPTIONS), {
      status: "failed",
      steps: looped,
      meta: { terminatedBy: "loop_graceful" },
    });
    const resumed = resumeFromStop(stopped);
    expect(loopGuidanceCycles(resumed.steps)).toBe(0);
    expect(detectLoopPattern(resumed.steps, 3, 3, 3)).toBeNull();
  });

  it("resumeMaxIterations covers the iteration and LLM-call counters", async () => {
    const stopped = await run(dyingKernel, { task: TASK }, recordingController([]));
    expect(resumeMaxIterations(stopped, 5)).toBe(Math.max(stopped.iteration, stopped.llmCalls ?? 0) + 5);
    expect(resumeMaxIterations(stopped, 0)).toBe(Math.max(stopped.iteration, stopped.llmCalls ?? 0) + 1);
  });

  it("guidance text is deterministic and names the repeated call, done tools and unfinished rows", () => {
    const text = loopResumeGuidanceText({
      reason: "loop_graceful",
      pattern: { id: "a", name: "repeated-tool-call" },
      repeatedTool: "web-search",
      repeatedCall: '{"q":"x"}',
      iteration: 4,
      toolsDone: [{ tool: "read-file", calls: 2 }],
      unfinished: ["a", "b"],
      goal: "do it",
    });
    expect(text).toBe(
      "The previous attempt stopped because of loop detection (repeated-tool-call: repeating without progress) at iteration 4. " +
        'It kept repeating: web-search {"q":"x"}. Do not make that call again. ' +
        "Already done (results are in the conversation; do not redo): read-file x2. " +
        "Unfinished: a; b. " +
        "Take a different approach and continue toward the original goal: do it. Deliver the answer as soon as the goal is met.",
    );
  });
});

describe("resumed run: idempotent, does not re-trip, delivers", () => {
  it("re-runs no completed step, survives the repeated call once, ends with the deliverable", async () => {
    const rows: { serialized: string; iteration: number }[] = [];
    const stopped = await run(dyingKernel, { task: TASK }, recordingController(rows));
    const priorActions = stopped.steps.filter((s) => s.type === "action");
    expect(priorActions.length).toBeGreaterThanOrEqual(3);

    // Resume from the CHECKPOINT (what Cortex / runtime will do), not the in-memory state.
    const fromCheckpoint = deserializeKernelState(rows[rows.length - 1]!.serialized);
    const resumedState = resumeFromStop(fromCheckpoint, { goal: TASK });

    const seen = { guidance: [] as string[], stepsAtFirstCall: -1, ran: [] as string[] };
    const finished = await run(
      resumedKernel(seen),
      { task: TASK, resumeState: resumedState },
      recordingController([]),
    );

    // The next prompt carried the corrective guidance on the FIRST resumed turn.
    expect(seen.guidance[0]).toContain("Do not make that call again");
    // Resumed from the stopped state, not a fresh start.
    expect(seen.stepsAtFirstCall).toBe(resumedState.steps.length);
    // Only NEW work ran: one repeated search + the write; the earlier steps are untouched.
    expect(seen.ran).toEqual(["web-search", "write-file"]);
    expect(finished.steps.slice(0, resumedState.steps.length)).toEqual([...resumedState.steps]);
    // The same repeated call did not re-trip the guard (old steps outside the window).
    expect(finished.meta.loopStop).toBeUndefined();
    expect(seen.guidance[1] ?? "").not.toContain("Loop detected");
    expect(finished.steps.slice(resumedState.steps.length).filter((s) => s.type === "harness_signal")).toEqual([]);
    expect(finished.status).toBe("done");
    expect(finished.output).toContain("2026-03-01");
  });

  it("the epoch marker is load-bearing: without it the same repeated call re-trips the detector", async () => {
    const stopped = await run(dyingKernel, { task: TASK }, recordingController([]));
    const resumed = resumeFromStop(stopped, { goal: TASK });
    const repeat = searchRound();
    // Marked: one more identical call is below the threshold. Unmarked (marker stripped): the old
    // repeated steps are back in the detector window and the very same call trips it.
    expect(detectLoopPattern([...resumed.steps, ...repeat], 3, 3, 3)).toBeNull();
    expect(detectLoopPattern([...resumed.steps.slice(0, -1), ...repeat], 3, 3, 3)?.pattern.id).toBe("a");
  });
});

describe("buildLoopStopRecord", () => {
  it("reads only substantive tools as done and leaves repeatedCall off a non-repeating tail", () => {
    const state = transitionState(initialKernelState(OPTIONS), {
      iteration: 3,
      steps: [
        ...toolRound("read-file", { path: "a.txt" }, true, "a.txt contents: v2.0 ships"),
        ...toolRound("web-search", { q: "one" }, false, "Error: x"),
        ...toolRound("web-search", { q: "two" }, false, "Error: x"),
      ],
    });
    const record = buildLoopStopRecord(state, { reason: "loop_graceful" });
    expect(record.toolsDone).toEqual([{ tool: "read-file", calls: 1 }]);
    expect(record.repeatedCall).toBeUndefined();
    expect(record.repeatedTool).toBeUndefined();
    expect(record.reason).toBe("loop_graceful");
    expect(record.iteration).toBe(3);
  });
});
