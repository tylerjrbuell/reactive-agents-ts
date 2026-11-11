// Run: bun test packages/runtime/tests/seam-run-outcome-events.test.ts --timeout 20000
//
// The public run outcome reaches the bus, and the harness never writes its own
// text into a run's output.
//
//  1. `AgentCompleted` carries `runOutcome` (the same value as
//     `AgentResult.outcome`) and the verified `deliverables`; a paused run
//     carries neither.
//  2. A sub-agent's `AgentCompleted` projects onto `StreamCompleted` with its
//     `outcome` and failure `error`.
//  3. `DebriefCompleted` says `abstained` for an abstention (it used to be
//     rewritten to `failed`).
//  4. A failed verification THINK retry ships output "" and its cause rides
//     the strategy result's `error` (it used to write "Verification retry
//     failed…" into `lastResponse`, which became the output).
//
// RED-ON-CUT:
//  - drop the `runOutcome` / `deliverables` spreads in run-finalize.ts -> cell 1 red.
//  - drop the `outcome` / `error` spreads in stream-scope.ts projectChildCompleted -> cell 2 red.
//  - restore the abstained->failed rewrite in debrief-synthesis.ts -> cell 3 red.
//  - restore the "Verification retry failed" lastResponse writes -> cell 4 red.
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import type { AgentEvent, Task } from "@reactive-agents/core";
import { ExecutionError } from "@reactive-agents/reasoning";
import { finalizeRun } from "../src/engine/finalize/run-finalize.js";
import { projectChildCompleted } from "../src/engine/stream-scope.js";
import { finalizeDebriefBackground, type PreparedDebrief } from "../src/engine/finalize/debrief-synthesis.js";
import { runVerificationThinkRetry } from "../src/engine/phases/agent-loop/verification-think-retry.js";
import { defaultReactiveAgentsConfig } from "../src/types.js";
import type { ExecutionContext } from "../src/types.js";
import type { ReasoningServiceLike } from "../src/engine/types-reasoning.js";
import type { EbLike } from "../src/engine/runtime-context.js";
import { makeExecutionContext, makeTask } from "../src/testing/index.js";

const recordingBus = (sink: AgentEvent[]): EbLike => ({
  publish: (event: AgentEvent) =>
    Effect.sync(() => {
      sink.push(event);
    }),
  on: () => Effect.succeed(() => {}),
});

/** A reasoning service whose every `execute` fails with a provider-style error. */
const failingReasoning: ReasoningServiceLike = {
  execute: () => Effect.fail(new ExecutionError({ strategy: "reactive", message: "connection refused" })),
  registerStrategy: () => Effect.void,
};

const completedOf = (sink: readonly AgentEvent[]) =>
  sink.find((e): e is Extract<AgentEvent, { _tag: "AgentCompleted" }> => e._tag === "AgentCompleted");

const ctx = (over: Partial<ExecutionContext["metadata"]> = {}): ExecutionContext =>
  makeExecutionContext({
    taskId: "t1",
    agentId: "a1",
    sessionId: "s1",
    phase: "complete",
    iteration: 2,
    maxIterations: 4,
    messages: [{ role: "user", content: "write report.md" }],
    selectedStrategy: "reactive",
    metadata: over,
  });

describe("AgentCompleted carries the public run outcome", () => {
  const writeTask: Task = makeTask({ id: "t1", type: "research", input: "Write the summary to report.md" });
  // The run's ledger records the landed file (the artifact authority).
  const runLedger = [{ kind: "artifact", seq: 0, iteration: 0, path: "report.md", op: "write" }];

  const publish = async (result: Record<string, unknown>, executionSucceeded: boolean) => {
    const sink: AgentEvent[] = [];
    await Effect.runPromise(
      finalizeRun({
        ctx: ctx(),
        task: writeTask,
        config: { ...defaultReactiveAgentsConfig("a1"), logging: { live: true } },
        eb: recordingBus(sink),
        result: result as never,
        executionStartMs: Date.now(),
        entropyLog: [],
        executionSucceeded,
      }),
    );
    return completedOf(sink);
  };

  it("publishes runOutcome and the verified deliverables on a terminal run", async () => {
    const event = await publish(
      {
        taskId: "t1",
        agentId: "a1",
        output: "",
        success: true,
        outcome: "success",
        metadata: { duration: 1, cost: 0, tokensUsed: 3, stepsCount: 1, runLedger },
      },
      true,
    );
    expect(event?.runOutcome).toBe("success");
    expect(event?.deliverables?.some((d) => d.produced && d.spec.includes("report.md"))).toBe(true);
  });

  it("publishes a failed runOutcome with its cause on error", async () => {
    const event = await publish(
      {
        taskId: "t1",
        agentId: "a1",
        output: "",
        success: false,
        outcome: "failed",
        error: "Reasoning failed.",
        metadata: { duration: 1, cost: 0, tokensUsed: 3, stepsCount: 0 },
      },
      false,
    );
    expect(event?.runOutcome).toBe("failed");
    expect(event?.error).toBe("Reasoning failed.");
  });

  it("a paused run carries neither runOutcome nor deliverables", async () => {
    const event = await publish(
      {
        taskId: "t1",
        agentId: "a1",
        output: "",
        success: false,
        awaitingApprovalFor: { gateId: "g", toolName: "file-write", args: {} },
        metadata: { duration: 1, cost: 0, tokensUsed: 3, stepsCount: 1, runLedger },
      },
      false,
    );
    expect(event).toBeDefined();
    expect(event?.runOutcome).toBeUndefined();
    expect(event?.deliverables).toBeUndefined();
  });
});

describe("a sub-agent's AgentCompleted projects its outcome", () => {
  it("forwards outcome and the failure cause onto StreamCompleted", () => {
    const chunk = projectChildCompleted({
      taskId: "child",
      success: false,
      output: "",
      runOutcome: "abstained",
      error: "The agent abstained: no source.",
    } as never);
    expect(chunk).toMatchObject({ _tag: "StreamCompleted", success: false, outcome: "abstained", error: "The agent abstained: no source." });
  });

  it("a success carries no error", () => {
    const chunk = projectChildCompleted({ taskId: "child", success: true, output: "ok", runOutcome: "success" } as never);
    expect(chunk).toMatchObject({ _tag: "StreamCompleted", outcome: "success" });
    expect(chunk._tag === "StreamCompleted" ? chunk.error : "wrong-tag").toBeUndefined();
  });
});

describe("DebriefCompleted keeps an abstention", () => {
  it("publishes outcome 'abstained', not 'failed'", async () => {
    const sink: AgentEvent[] = [];
    const debrief = {
      outcome: "abstained" as const,
      summary: "Declined: no source.",
      keyFindings: [],
      errorsEncountered: [],
      lessonsLearned: [],
      confidence: "low" as const,
      toolsUsed: [],
      metrics: { tokens: 1, duration: 1, iterations: 1, cost: 0 },
      rationale: [],
      markdown: "",
    };
    const prepared: PreparedDebrief = {
      debriefInput: {
        taskPrompt: "q",
        agentId: "a1",
        taskId: "t1",
        terminatedBy: "abstained",
        toolCallHistory: [],
        errorsFromLoop: [],
        metrics: { tokens: 1, duration: 1, iterations: 1, cost: 0 },
      },
      fallbackDebrief: debrief,
      errorsFromLoop: [],
      executionDurationMs: 1,
      shouldFinalize: true,
      shouldSynthesizeLLM: false,
    };
    await Effect.runPromise(
      finalizeDebriefBackground(
        {
          ctx: ctx(),
          task: makeTask({ id: "t1", type: "research", input: "q" }),
          config: defaultReactiveAgentsConfig("a1"),
          eb: recordingBus(sink),
          rr: { status: "abstained" },
          terminatedByRaw: "abstained",
          sanitizedOutput: "",
          outputForSuccess: "",
          hasSubstantiveOutput: false,
          toolCallLog: [],
        },
        prepared,
      ),
    );
    const event = sink.find((e) => e._tag === "DebriefCompleted");
    expect(event?._tag === "DebriefCompleted" ? event.debrief.outcome : undefined).toBe("abstained");
  });
});

describe("a failed verification retry writes no harness text into the output", () => {
  const task: Task = makeTask({ id: "t1", type: "research", input: "write the report" });
  const firstPass = {
    output: "The report is written.",
    status: "completed",
    metadata: { cost: 0, tokensUsed: 5, stepsCount: 1 },
  };

  const retryWith = (service: ReasoningServiceLike) =>
    Effect.runPromise(
      runVerificationThinkRetry(ctx({ lastResponse: "The report is written.", reasoningResult: firstPass }), {
        config: { ...defaultReactiveAgentsConfig("a1"), provider: "test" },
        task,
        reasoningOpt: { _tag: "Some", value: service },
        taskCategory: "general",
        resolvedCalibration: undefined,
        obs: null,
        eb: null,
      }),
    );

  it("reasoning failure: output '' and the cause on the strategy result's error", async () => {
    const after = await retryWith(failingReasoning);
    expect(after.metadata.lastResponse).toBe("");
    expect(after.metadata.reasoningResult?.status).toBe("failed");
    expect(after.metadata.reasoningResult?.error).toContain("Verification retry failed");
    expect(after.metadata.reasoningResult?.error).toContain("connection refused");
    expect(after.metadata.reasoningResult?.output).toBe("");
  });
});
