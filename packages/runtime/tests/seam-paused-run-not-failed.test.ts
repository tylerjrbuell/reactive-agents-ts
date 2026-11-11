// Run: bun test packages/runtime/tests/seam-paused-run-not-failed.test.ts --timeout 20000
//
// A run paused at an approval gate has not ended, so it has not failed.
//
// Defect (2026-11-11, Cortex step-4 QA, run 01M74NXE…): a durable run paused on
// an approval gate with a declared deliverable published
// `AgentCompleted{success:false, error:"A declared deliverable was not
// produced."}`. The runtime's deliverable veto ran on the unfinished run, and
// finalize published the terminal events for a run that was only waiting, so
// every bus consumer recorded it as failed.
//
// Pins (engine path, scripted provider, durable + detach approval):
//   P1 — no `AgentCompleted` / `TaskCompleted` for the paused run.
//   P2 — `AgentResult.status === "awaiting-approval"`, no `error`, no outcome.
//   P3 — no runtime veto marker is stamped on the paused run.
//
// Red-on-cut:
//   - drop the paused early return in engine/execute-success-invariants.ts
//     -> P2 (error) and P3 red.
//   - drop the `!paused` guard on the terminal publishes in
//     engine/finalize/run-finalize.ts -> P1 red.
import { afterAll, describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentEvent } from "@reactive-agents/core";
import { ReactiveAgents } from "../src/builder.js";
import { deriveExecutionSuccess } from "../src/engine/execute-success-invariants.js";
import type { ExecutionContext } from "../src/types.js";

const dir = mkdtempSync(join(tmpdir(), "ra-paused-not-failed-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const riskyTool = {
  definition: {
    name: "risky-tool",
    description: "Mutates state — requires approval.",
    parameters: [{ name: "input", type: "string" as const, description: "Input", required: true }],
    riskLevel: "high" as const,
    requiresApproval: true,
    timeoutMs: 5_000,
    source: "function" as const,
  },
  handler: () => Effect.succeed("ran"),
};

describe("a run paused at an approval gate is not a failed run", () => {
  it("P1+P2: no terminal events, status awaiting-approval, no error", async () => {
    const agent = await ReactiveAgents.create()
      .withName("paused-not-failed")
      .withProvider("test")
      .withTestScenario([{ toolCall: { name: "risky-tool", args: { input: "go" } } }] as never)
      .withTools({ tools: [riskyTool] })
      .withRequiredTools({ tools: ["risky-tool"] })
      .withReasoning({ defaultStrategy: "reactive", enableStrategySwitching: false })
      .withMaxIterations(4)
      .withDurableRuns({ dir, checkpointEvery: 1 })
      .withApprovalPolicy({ tools: ["risky-tool"], mode: "detach" })
      .build();

    const events: AgentEvent[] = [];
    const unsubscribe = await agent.subscribe((event) => {
      events.push(event);
    });
    try {
      const result = await agent.run("Use the risky tool with input go and write the result to ./report.md");
      expect(result.status).toBe("awaiting-approval");
      expect(result.pendingApproval?.toolName).toBe("risky-tool");
      expect(result.error).toBeUndefined();
      expect(result.outcome).toBeUndefined();
    } finally {
      unsubscribe();
      await agent.dispose();
    }
    const terminal = events.filter((e) => e._tag === "AgentCompleted" || e._tag === "TaskCompleted");
    expect(terminal).toEqual([]);
  }, 30_000);

  it("P3: the success invariants stamp no runtime veto on a paused run", () => {
    const ctx = {
      taskId: "t1",
      agentId: "a1",
      sessionId: "s1",
      phase: "complete",
      agentState: "completed",
      iteration: 1,
      maxIterations: 4,
      messages: [],
      toolResults: [],
      cost: 0,
      tokensUsed: 0,
      startedAt: new Date(),
      metadata: {},
    } as ExecutionContext;
    const rr: NonNullable<ExecutionContext["metadata"]["reasoningResult"]> = {
      output: "Run paused — awaiting human approval.",
      status: "partial",
      metadata: {
        cost: 0,
        tokensUsed: 0,
        stepsCount: 1,
        terminatedBy: "end_turn",
        ...{ awaitingApprovalFor: { gateId: "g", toolName: "risky-tool", args: {} } },
      },
    };
    const { executionSucceeded } = deriveExecutionSuccess({
      ctx,
      task: {
        id: "t1",
        agentId: "a1",
        type: "query",
        input: { question: "Use the risky tool and write the result to ./report.md" },
        priority: "medium",
        status: "running",
        metadata: { tags: [] },
        createdAt: new Date(),
      } as never,
      config: { requiredTools: { tools: ["risky-tool"] } } as never,
      rr,
      hasSubstantiveOutput: false,
      outputForSuccess: "",
      toolCallLog: [],
    });
    expect(executionSucceeded).toBe(false);
    const meta = ctx.metadata as Record<string, unknown>;
    for (const marker of [
      "emptyOutputFailure",
      "unproducedDeliverableFailure",
      "requiredToolUnmetNotSuccess",
      "outstandingContractNotSuccess",
      "terminalOutcomeNotSuccess",
    ]) {
      expect(meta[marker]).toBeUndefined();
    }
  });
});
