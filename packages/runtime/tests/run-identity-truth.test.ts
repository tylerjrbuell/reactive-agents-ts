// Run: bun test packages/runtime/tests/run-identity-truth.test.ts --timeout 20000
//
// Run truth on the event bus (Cortex bench QA, 2026-11-11,
// wiki/Research/Audit-Reports-2026-11-11/cortex-bench-qa.md). Three lies any
// event observer saw:
//
// 1. A resumed durable run published AgentStarted / AgentCompleted under the
//    durable run id while its kernel events used the ORIGINAL task id, so the
//    original run never ended in any observer. One run, one task id: the
//    resume adopts the task id its checkpoint was captured under.
// 2. An abstained run's `abstention.reason` was the decline cut at 200
//    characters mid-word. The decline itself stays on `output`: the core
//    contract (AgentCompleted.runOutcome) empties output only for "failed".
// 3. AgentCompleted.totalIterations counted reasoning steps (23 for 8 loops),
//    not kernel loops.
//
// RED-ON-CUT:
// - (1) revert `taskId: payload.taskId ?? runId` to `taskId: runId` in
//   agent/durable-facade.ts decideAndResumeRun -> the resume cell fails.
// - (2) the reason cut was fixed at the source (reasoning: arbitrator.ts and
//   finalize-result.ts no longer slice the reason to 200 chars); this cell
//   pins it end to end through the runtime result and AgentCompleted.
//   Re-adding `.slice(0, 200)` there -> the abstention cell fails.
// - (3) revert `totalIterations: runLoopCount(...)` to `ctx.iteration` in
//   engine/finalize/run-finalize.ts -> the loop-count cell fails.
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentEvent } from "@reactive-agents/core";
import { ReactiveAgents } from "../src/builder.js";
import { RunStoreService, RunStoreLive } from "../src/services/run-store.js";
import { checkpointTaskId } from "../src/engine/durable-resume.js";
import { runLoopCount } from "../src/engine/finalize/run-finalize.js";

type Completed = Extract<AgentEvent, { _tag: "AgentCompleted" }>;

const taskIdOf = (e: AgentEvent): string | undefined => {
  const id = (e as { taskId?: unknown }).taskId;
  return typeof id === "string" ? id : undefined;
};

// ── 1. Resume identity ───────────────────────────────────────────────────────

function makeDurableAgent(dir: string) {
  return ReactiveAgents.create()
    .withName("run-identity")
    .withSystemPrompt("You are precise.")
    .withTestScenario([{ text: "FINAL ANSWER: done" }])
    .withTools({
      tools: [
        {
          definition: {
            name: "risky-tool",
            description: "Tool risky-tool",
            parameters: [{ name: "input", type: "string" as const, description: "Input", required: true }],
            riskLevel: "low" as const,
            timeoutMs: 5_000,
            requiresApproval: false,
            source: "function" as const,
          },
          handler: () => Effect.succeed("ran"),
        },
      ],
    })
    .withReasoning()
    .withMaxIterations(4)
    .withDurableRuns({ dir, checkpointEvery: 1 })
    .withApprovalPolicy({ tools: ["risky-tool"], mode: "detach" })
    .build();
}

describe("a resumed durable run keeps one task id", () => {
  it("approveRun publishes lifecycle AND kernel events under the original task id", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-run-identity-"));
    try {
      const a = await makeDurableAgent(dir);
      const seedEvents: AgentEvent[] = [];
      const unsubA = await a.subscribe((e) => void seedEvents.push(e));
      for await (const _ev of a.runStream("compute the answer")) void _ev;
      unsubA();
      const runId = (await a.listRuns())[0]!.runId;
      const originalTaskId = taskIdOf(seedEvents.find((e) => e._tag === "AgentStarted")!);
      expect(originalTaskId).toBeDefined();
      // The bug's precondition: the durable run id is NOT the task id.
      expect(runId).not.toBe(originalTaskId);

      // Pause the run (as a detach gate would) and resume it from a fresh instance.
      await Effect.runPromise(
        Effect.gen(function* () {
          const store = yield* RunStoreService;
          yield* store.setStatus(runId, "awaiting-approval");
          yield* store.putApproval({ runId, gateId: "gate-1", toolName: "risky-tool", argsJson: "{}" });
        }).pipe(Effect.provide(RunStoreLive(join(dir, "runs.db")))),
      );
      await a.dispose();

      const b = await makeDurableAgent(dir);
      try {
        const events: AgentEvent[] = [];
        const unsubB = await b.subscribe((e) => void events.push(e));
        const resumed = await b.approveRun(runId);
        unsubB();

        expect(events.some((e) => e._tag === "AgentStarted")).toBe(true);
        expect(events.some((e) => e._tag === "AgentCompleted")).toBe(true);
        const ids = new Set(events.map(taskIdOf).filter((id): id is string => id !== undefined));
        expect([...ids]).toEqual([originalTaskId!]);
        expect(resumed.taskId).toBe(originalTaskId!);
      } finally {
        await b.dispose();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 45000);

  it("checkpointTaskId reads the task id a checkpoint was captured under, undefined on corrupt input", () => {
    const json = JSON.stringify({ codecVersion: 1, state: { taskId: "01ORIGINAL", iteration: 3 } });
    expect(checkpointTaskId(json)).toBe("01ORIGINAL");
    expect(checkpointTaskId("{not json")).toBeUndefined();
    expect(checkpointTaskId(JSON.stringify({ codecVersion: 1, state: { taskId: "" } }))).toBeUndefined();
    expect(checkpointTaskId(JSON.stringify({ codecVersion: 1, state: null }))).toBeUndefined();
  });
});

// ── 2. Abstention reason ─────────────────────────────────────────────────────

// A give-up with no tool behind it: the kernel's honesty gate reclassifies it
// as an abstention. Longer than 200 chars so the kernel's reason cut shows.
const DECLINE =
  "The available tools do not include a function for reading account statements. The task cannot be completed with the current toolset, " +
  "because there is no integration that can open the statement or read its line items on your behalf.";

describe("an abstained run carries its full reason", () => {
  it("abstention.reason is the full decline; output keeps the decline", async () => {
    expect(DECLINE.length).toBeGreaterThan(200);
    const agent = await ReactiveAgents.create()
      .withName("abstain-output")
      .withProvider("test")
      .withModel("test")
      .withTestScenario([{ text: DECLINE }, { text: DECLINE }] as never)
      .withTools({ builtins: false })
      .withReasoning({ defaultStrategy: "reactive" })
      .withMaxIterations(2)
      .build();
    try {
      const completed: Completed[] = [];
      const unsub = await agent.subscribe("AgentCompleted", (e) => void completed.push(e));
      const result = await agent.run("Reconcile the totals in my latest account statement.");
      unsub();

      // Precondition: this run took the abstention path.
      expect(result.terminatedBy).toBe("abstained");
      expect(result.outcome).toBe("abstained");
      // "abstained" is an honest decline, not "failed": the text is not dropped.
      expect(result.output).toBe(DECLINE);
      expect(result.abstention?.reason).toBe(DECLINE);
      expect(completed).toHaveLength(1);
      expect(completed[0]!.output).toBe(DECLINE);
    } finally {
      await agent.dispose();
    }
  }, 30000);

});

// ── 3. Loop count ────────────────────────────────────────────────────────────

describe("totalIterations counts kernel loops", () => {
  it("runLoopCount prefers the kernel's own final iteration over the step count", () => {
    expect(runLoopCount(23, { extensions: { kernelIteration: 8 } })).toBe(8);
    expect(runLoopCount(23, undefined)).toBe(23);
    expect(runLoopCount(5, { extensions: { kernelIteration: Number.NaN } })).toBe(5);
  });

  it("AgentCompleted.totalIterations matches the iteration of the last ReasoningIterationProgress", async () => {
    const agent = await ReactiveAgents.create()
      .withName("loop-count")
      .withProvider("test")
      .withModel("test")
      .withTestScenario([
        { toolCall: { name: "recall", args: { key: "a" } } },
        { toolCall: { name: "recall", args: { key: "b" } } },
        { text: "FINAL ANSWER: 42" },
      ] as never)
      .withReasoning({ defaultStrategy: "reactive" })
      .withMaxIterations(6)
      .build();
    try {
      const events: AgentEvent[] = [];
      const unsub = await agent.subscribe((e) => void events.push(e));
      await agent.run("What is 6 times 7?");
      unsub();
      const steps = events.filter((e) => e._tag === "ReasoningStepCompleted").length;
      const loops = events
        .filter((e): e is Extract<AgentEvent, { _tag: "ReasoningIterationProgress" }> => e._tag === "ReasoningIterationProgress")
        .map((e) => e.iteration);
      const completed = events.find((e): e is Completed => e._tag === "AgentCompleted")!;
      expect(loops.length).toBeGreaterThan(0);
      // Precondition: steps outnumber loops, so a step count cannot pass.
      expect(steps).toBeGreaterThan(Math.max(...loops));
      expect(completed.totalIterations).toBe(Math.max(...loops));
    } finally {
      await agent.dispose();
    }
  }, 30000);
});
