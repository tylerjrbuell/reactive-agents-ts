// File: tests/strategies/blueprint/worker.test.ts
//
// blueprint Worker — 0-LLM dependency-ordered DAG tool execution.
//
// Covers:
//  (a) independent steps run, results captured
//  (b) #E (`{{from_step:sN}}`) dependency resolved from a prior step's result
//  (c) unresolved / failed dependency → step FAILED (not blanked) + downstream fail
//  (d) a write-tool step never runs concurrently with other steps in its wave
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { LLMService, TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { ToolService } from "@reactive-agents/tools";
import {
  executeBlueprintWorker,
  type BlueprintWorkerContext,
} from "../../../src/strategies/blueprint/worker.js";
import { resolveStrategyServices } from "../../../src/kernel/utils/service-utils.js";
import type { Plan, PlanStep } from "../../../src/types/plan.js";

// ── Helpers ───────────────────────────────────────────────────────────────

/** Build a hydrated tool_call PlanStep with the fields the worker reads. */
function toolStep(
  id: string,
  seq: number,
  toolName: string,
  toolArgs: Record<string, unknown>,
  extra: Partial<PlanStep> = {},
): PlanStep {
  return {
    id,
    seq,
    title: `step ${id}`,
    instruction: `run ${toolName}`,
    type: "tool_call",
    toolName,
    toolArgs,
    status: "pending",
    retries: 0,
    tokensUsed: 0,
    ...extra,
  };
}

function makePlan(steps: PlanStep[]): Plan {
  const now = new Date().toISOString();
  return {
    id: "plan_test",
    taskId: "task-1",
    agentId: "agent-1",
    goal: "test the worker",
    mode: "dag",
    steps,
    status: "active",
    version: 1,
    createdAt: now,
    updatedAt: now,
    totalTokens: 0,
    totalCost: 0,
  };
}

interface ExecRecord {
  toolName: string;
  args: Record<string, unknown>;
  /** Number of executions in flight when this call STARTED (concurrency probe). */
  inFlightAtStart: number;
}

/**
 * Stub ToolService whose `execute` records the tool name, resolved args, and
 * how many calls were concurrently in-flight when it started. Each tool's
 * result echoes back a deterministic string so dependency substitution can be
 * asserted. A small async delay widens the window for the concurrency probe.
 */
function makeRecordingToolService(opts: { failTools?: ReadonlySet<string> } = {}) {
  const calls: ExecRecord[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const failTools = opts.failTools ?? new Set<string>();

  const layer = Layer.succeed(
    ToolService,
    ToolService.of({
      execute: (req: { toolName: string; arguments?: Record<string, unknown> }) =>
        Effect.gen(function* () {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          const rec: ExecRecord = {
            toolName: req.toolName,
            args: req.arguments ?? {},
            inFlightAtStart: inFlight,
          };
          calls.push(rec);
          // Yield so parallel dispatches overlap before any completes.
          yield* Effect.sleep("15 millis");
          inFlight -= 1;
          if (failTools.has(req.toolName)) {
            return { success: false, result: `tool ${req.toolName} failed` };
          }
          return {
            success: true,
            result: `result-of-${req.toolName}`,
          };
        }),
      getTool: (name: string) =>
        Effect.succeed({
          name,
          description: "test tool",
          parameters: [{ name: "input", type: "string", required: false }],
        }),
      register: () => Effect.void,
      listTools: () => Effect.succeed([]),
      deregister: () => Effect.void,
    } as unknown as Parameters<typeof ToolService.of>[0]),
  );

  return { calls, layer, getMaxInFlight: () => maxInFlight };
}

const ctx: BlueprintWorkerContext = {
  taskId: "task-1",
  agentId: "agent-1",
  emitLog: () => Effect.void,
};

/** Resolve StrategyServices then run the worker, providing the given tool layer. */
function runWorker(
  plan: Plan,
  toolLayer: Layer.Layer<ToolService>,
  concurrency = 4,
  llmTurns: ReadonlyArray<{ text: string }> = [],
) {
  return Effect.runPromise(
    resolveStrategyServices.pipe(
      Effect.flatMap((services) =>
        executeBlueprintWorker(plan, services, ctx, { concurrency }),
      ),
      Effect.provide(Layer.mergeAll(toolLayer, TestLLMServiceLayer([...llmTurns]))),
    ),
  );
}

// ── (a) independent steps run, results captured ─────────────────────────────

describe("blueprint worker — independent steps", () => {
  it("runs all independent tool steps and captures results", async () => {
    const { calls, layer } = makeRecordingToolService();
    const plan = makePlan([
      toolStep("s1", 1, "web-search", { query: "alpha" }),
      toolStep("s2", 2, "web-fetch", { url: "https://example.com" }),
    ]);

    const out = await runWorker(plan, layer);

    expect(out.allSucceeded).toBe(true);
    expect(out.steps.length).toBe(2);
    expect(out.steps.every((s) => s.status === "completed")).toBe(true);
    expect(out.steps[0]!.result).toBe("result-of-web-search");
    expect(out.steps[1]!.result).toBe("result-of-web-fetch");
    // Both tools actually dispatched.
    expect(calls.map((c) => c.toolName).sort()).toEqual(["web-fetch", "web-search"]);
  });

  it("skips non-tool_call steps (analysis handled by the strategy)", async () => {
    const { calls, layer } = makeRecordingToolService();
    const analysis: PlanStep = {
      id: "s2",
      seq: 2,
      title: "summarize",
      instruction: "summarize",
      type: "analysis",
      status: "pending",
      retries: 0,
      tokensUsed: 0,
    };
    const plan = makePlan([toolStep("s1", 1, "web-search", { query: "x" }), analysis]);

    const out = await runWorker(plan, layer);

    // Only the tool_call step is in the worker's output.
    expect(out.steps.length).toBe(1);
    expect(out.steps[0]!.id).toBe("s1");
    expect(calls.length).toBe(1);
  });
});

// ── (b) #E dependency resolved from prior step ──────────────────────────────

describe("blueprint worker — dependency resolution", () => {
  it("resolves {{from_step:sN}} from a prior step's result", async () => {
    const { calls, layer } = makeRecordingToolService();
    const plan = makePlan([
      toolStep("s1", 1, "web-search", { query: "seed" }),
      toolStep("s2", 2, "web-fetch", { url: "{{from_step:s1}}" }),
    ]);

    const out = await runWorker(plan, layer);

    expect(out.allSucceeded).toBe(true);
    // s2's url arg was substituted with s1's result before dispatch.
    const s2Call = calls.find((c) => c.toolName === "web-fetch")!;
    expect(s2Call.args.url).toBe("result-of-web-search");
  });
});

// ── (c) unresolved / failed dependency → FAILED (not blanked) ───────────────

describe("blueprint worker — fail-on-unresolved-ref", () => {
  it("fails a step whose {{from_step}} references a non-existent step (not blanked)", async () => {
    const { calls, layer } = makeRecordingToolService();
    // s1 references s9 which does not exist → computeWaves treats s1 as a
    // cycle/unresolvable and the worker pre-fails it on unmet dependency.
    const plan = makePlan([
      toolStep("s1", 1, "web-fetch", { url: "{{from_step:s9}}" }),
    ]);

    const out = await runWorker(plan, layer);

    expect(out.allSucceeded).toBe(false);
    const s1 = out.steps.find((s) => s.id === "s1")!;
    expect(s1.status).toBe("failed");
    expect(s1.error).toBeDefined();
    // NOT blanked: the tool was never dispatched with an empty url.
    expect(calls.length).toBe(0);
  });

  it("fails downstream steps when their dependency step fails", async () => {
    // s1 fails at the tool; s2 depends on s1 → s2 must also fail (not run with a
    // blanked arg).
    const { calls, layer } = makeRecordingToolService({
      failTools: new Set(["web-search"]),
    });
    const plan = makePlan([
      toolStep("s1", 1, "web-search", { query: "seed" }),
      toolStep("s2", 2, "web-fetch", { url: "{{from_step:s1}}" }),
    ]);

    const out = await runWorker(plan, layer);

    expect(out.allSucceeded).toBe(false);
    const s1 = out.steps.find((s) => s.id === "s1")!;
    const s2 = out.steps.find((s) => s.id === "s2")!;
    expect(s1.status).toBe("failed");
    expect(s2.status).toBe("failed");
    expect(s2.error).toContain("s1");
    // s2's tool never dispatched (the dependency poisoned the chain).
    expect(calls.some((c) => c.toolName === "web-fetch")).toBe(false);
  });
});

// ── (e) already-completed steps are not re-executed (patch-retry idempotency) ─

describe("blueprint worker — completed-step idempotency", () => {
  it("does not re-dispatch a tool_call step that arrives already completed", async () => {
    const { calls, layer } = makeRecordingToolService();
    // s1 arrives pre-completed (as it would on a patch-retry re-run); only the
    // new s2 should dispatch. s1's preserved result must remain intact and be
    // resolvable as a dependency.
    const plan = makePlan([
      toolStep("s1", 1, "web-search", { query: "seed" }, {
        status: "completed",
        result: "preserved-s1-result",
      }),
      toolStep("s2", 2, "web-fetch", { url: "{{from_step:s1}}" }),
    ]);

    const out = await runWorker(plan, layer);

    expect(out.allSucceeded).toBe(true);
    // s1 was NOT re-run; only s2's tool dispatched.
    expect(calls.map((c) => c.toolName)).toEqual(["web-fetch"]);
    // s1's preserved result survived untouched.
    const s1 = out.steps.find((s) => s.id === "s1")!;
    expect(s1.result).toBe("preserved-s1-result");
    expect(s1.status).toBe("completed");
    // s2 resolved its {{from_step:s1}} against the preserved result.
    const s2Call = calls.find((c) => c.toolName === "web-fetch")!;
    expect(s2Call.args.url).toBe("preserved-s1-result");
  });
});

// ── (f) intermediate analysis dependency — tool consumes analysis output ─────

describe("blueprint worker — intermediate analysis dependency", () => {
  it("executes an analysis step inline so a downstream tool consumes its output", async () => {
    const { calls, layer } = makeRecordingToolService();
    const summarize: PlanStep = {
      id: "s2", seq: 2, title: "summarize", instruction: "Summarize the commits",
      type: "analysis", status: "pending", retries: 0, tokensUsed: 0, dependsOn: ["s1"],
    };
    const plan = makePlan([
      toolStep("s1", 1, "web-search", { query: "commits" }),
      summarize,
      // file-write depends on the ANALYSIS output, not a tool output.
      toolStep("s3", 3, "file-write", { path: "./out.md", content: "{{from_step:s2}}" }, {
        dependsOn: ["s2"],
      }),
    ]);

    // TestLLM answers the analysis step's complete() call with the summary.
    const out = await runWorker(plan, layer, 4, [{ text: "## Summary\n- did the work" }]);

    expect(out.allSucceeded).toBe(true);
    // The analysis step ran and produced a result.
    const s2 = out.steps.find((s) => s.id === "s2")!;
    expect(s2.status).toBe("completed");
    expect(s2.result).toContain("did the work");
    // file-write's {{from_step:s2}} resolved to the ANALYSIS output (not pre-failed).
    const writeCall = calls.find((c) => c.toolName === "file-write")!;
    expect(writeCall.args.content).toBe("## Summary\n- did the work");
  });

  it("does NOT execute a terminal analysis step (no tool depends on it) — left for SOLVE", async () => {
    const { calls, layer } = makeRecordingToolService();
    const terminal: PlanStep = {
      id: "s2", seq: 2, title: "summarize", instruction: "Summarize",
      type: "analysis", status: "pending", retries: 0, tokensUsed: 0, dependsOn: ["s1"],
    };
    const plan = makePlan([
      toolStep("s1", 1, "web-search", { query: "x" }),
      terminal,
    ]);

    // No LLM turns provided — if the worker tried to run the terminal analysis,
    // the test LLM would have nothing to answer with. It must be left for SOLVE.
    const out = await runWorker(plan, layer, 4, []);

    expect(out.allSucceeded).toBe(true);
    // Only the tool step was executed by the worker.
    expect(out.steps.some((s) => s.id === "s2")).toBe(false);
    expect(calls.map((c) => c.toolName)).toEqual(["web-search"]);
  });
});

// ── (d) write-tool step never runs concurrently ─────────────────────────────

describe("blueprint worker — parallel-safety split", () => {
  it("runs a write tool sequentially, never concurrently with wave peers", async () => {
    const { calls, layer, getMaxInFlight } = makeRecordingToolService();
    // Three independent steps in one wave; one is a write tool (parallel-unsafe).
    const plan = makePlan([
      toolStep("s1", 1, "web-search", { query: "a" }),
      toolStep("s2", 2, "web-search", { query: "b" }),
      toolStep("s3", 3, "file-write", { path: "/tmp/x", content: "data" }),
    ]);

    const out = await runWorker(plan, layer, 4);

    expect(out.allSucceeded).toBe(true);
    // The two search tools may overlap, but the file-write must have started
    // alone (its in-flight-at-start count is 1).
    const writeCall = calls.find((c) => c.toolName === "file-write")!;
    expect(writeCall.inFlightAtStart).toBe(1);
    // Parallel-safe pair did fan out — global max in-flight reached 2.
    expect(getMaxInFlight()).toBeGreaterThanOrEqual(2);
  });
});
