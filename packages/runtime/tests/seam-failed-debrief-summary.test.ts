// Run: bun test packages/runtime/tests/seam-failed-debrief-summary.test.ts --timeout 20000
//
// A failed run's debrief says it failed and why. It never reads "Task completed."
//
// Defect (2026-11-11, Cortex step-4 QA, run 01M74NV0…): a failed run with no
// answer text got the fallback debrief summary "Task completed.", because the
// summary fell through `finalAnswerCapture.summary ?? output ?? "Task
// completed."` without looking at the outcome. A run the runtime vetoed after
// the kernel finished (unproduced deliverable) was worse: the debrief classifier
// never saw the veto, so the record also said `outcome: "success"`.
//
// Pins (engine/finalize/debrief-synthesis.ts `prepareDebrief`, the critical-path
// debrief every run gets):
//   D1 — kernel failure: outcome failed, summary is the run's cause.
//   D2 — runtime veto over a kernel `completed`: outcome failed (never success),
//        summary names the veto's cause.
//   D3 — a successful run keeps its own summary.
//   D4 — a paused run gets no failure cause in its debrief.
//
// Red-on-cut:
//   - drop the `failureCause` computation in prepareDebrief -> D1, D2 red.
//   - drop the outcome downgrade in debrief.ts `deriveOutcome` -> D2 red.
import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import type { Task } from "@reactive-agents/core";
import { prepareDebrief, type DebriefSynthesisDeps } from "../src/engine/finalize/debrief-synthesis.js";
import { defaultReactiveAgentsConfig } from "../src/types.js";
import type { ExecutionContext } from "../src/types.js";
import { makeExecutionContext, makeTask } from "../src/testing/index.js";

const task: Task = makeTask({ id: "t1", type: "research", input: "Write the summary to report.md" });

const ctx = (metadata: Partial<ExecutionContext["metadata"]> = {}): ExecutionContext =>
  makeExecutionContext({
    taskId: "t1",
    agentId: "a1",
    sessionId: "s1",
    phase: "complete",
    iteration: 2,
    maxIterations: 4,
    messages: [{ role: "user", content: "write report.md" }],
    selectedStrategy: "reactive",
    metadata,
  });

const prepare = (deps: Partial<DebriefSynthesisDeps> & Pick<DebriefSynthesisDeps, "rr" | "terminatedByRaw">) =>
  Effect.runPromise(
    prepareDebrief({
      ctx: ctx(),
      task,
      config: { ...defaultReactiveAgentsConfig("a1"), enableMemory: true },
      eb: null,
      sanitizedOutput: "",
      outputForSuccess: "",
      hasSubstantiveOutput: false,
      toolCallLog: [],
      ...deps,
    }),
  );

describe("a failed run's debrief reports the failure and its cause", () => {
  it("D1 kernel failure: outcome failed, summary = the cause", async () => {
    const cause = "ollama call failed (ollama:qwen3): unexpected EOF";
    const { fallbackDebrief } = await prepare({
      rr: { status: "failed", output: "", error: cause, metadata: { terminatedBy: "llm_error" } },
      terminatedByRaw: "llm_error",
      executionSucceeded: false,
    });
    expect(fallbackDebrief?.outcome).toBe("failed");
    expect(fallbackDebrief?.summary).not.toBe("Task completed.");
    expect(fallbackDebrief?.summary).toContain(cause);
  });

  it("D2 runtime veto over a kernel 'completed': outcome failed, summary names the veto", async () => {
    const { fallbackDebrief } = await prepare({
      ctx: ctx({ unproducedDeliverableFailure: true }),
      rr: { status: "completed", output: "", metadata: { terminatedBy: "final_answer" } },
      terminatedByRaw: "final_answer",
      executionSucceeded: false,
    });
    expect(fallbackDebrief?.outcome).toBe("failed");
    expect(fallbackDebrief?.summary).not.toBe("Task completed.");
    expect(fallbackDebrief?.summary).toContain("A declared deliverable was not produced.");
    expect(fallbackDebrief?.markdown).not.toContain("Task completed.");
  });

  it("D3 a successful run keeps its own summary", async () => {
    const answer = "The summary is in report.md.";
    const { fallbackDebrief } = await prepare({
      rr: { status: "completed", output: answer, metadata: { terminatedBy: "final_answer" } },
      terminatedByRaw: "final_answer",
      sanitizedOutput: answer,
      outputForSuccess: answer,
      hasSubstantiveOutput: true,
      executionSucceeded: true,
    });
    expect(fallbackDebrief?.outcome).toBe("success");
    expect(fallbackDebrief?.summary).toBe(answer);
  });

  it("D4 a paused run carries no failure cause", async () => {
    const { debriefInput } = await prepare({
      rr: {
        status: "partial",
        output: "",
        metadata: { terminatedBy: "end_turn", awaitingApprovalFor: { gateId: "g", toolName: "file-write", args: {} } },
      } as DebriefSynthesisDeps["rr"],
      terminatedByRaw: "end_turn",
      executionSucceeded: false,
    });
    expect(debriefInput.failureCause).toBeUndefined();
  });
});
