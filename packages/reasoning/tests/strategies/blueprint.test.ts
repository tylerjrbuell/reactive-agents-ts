// File: tests/strategies/blueprint.test.ts
//
// blueprint Strategy — PLAN → VERIFY → EXECUTE (0-LLM, parallel DAG) → SOLVE.
//
// Covers:
//  (a) happy path — plan→execute→solve produces a result with ~2 LLM calls
//      (1 planner via completeStructured + 1 solver via complete).
//  (b) invalid plan (dangling dependency) → degrades to reactive.
//  (c) tier branch — a local model with sequential-only calibration runs the
//      worker at concurrency 1 (the write/parallel-unsafe + parallel-safe peers
//      never overlap).
//  (d) required-tool repair ("repaired" verify status) still executes the
//      injected synthetic step.
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import {
  LLMService,
  TestLLMService,
  type ModelCalibration,
} from "@reactive-agents/llm-provider";
import { ToolService } from "@reactive-agents/tools";
import type { TestTurn } from "@reactive-agents/llm-provider";
import { executeBlueprint } from "../../src/strategies/blueprint.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import type { ToolSchema } from "../../src/kernel/capabilities/attend/tool-formatting.js";

// ── Counting LLM layer ───────────────────────────────────────────────────────
//
// Wraps TestLLMService to count complete() + completeStructured() invocations so
// we can assert blueprint's "~2 LLM calls" efficiency claim.

function countingLLMLayer(scenario: TestTurn[]) {
  const counts = { complete: 0, completeStructured: 0 };
  const inner = TestLLMService(scenario);
  const wrapped: typeof LLMService.Service = {
    ...inner,
    complete: (req) => {
      counts.complete += 1;
      return inner.complete(req);
    },
    completeStructured: (req) => {
      counts.completeStructured += 1;
      return inner.completeStructured(req);
    },
  };
  return { layer: Layer.succeed(LLMService, LLMService.of(wrapped)), counts };
}

// ── Recording ToolService (concurrency probe) ────────────────────────────────

interface ExecRecord {
  toolName: string;
  args: Record<string, unknown>;
  inFlightAtStart: number;
}

function makeRecordingToolService() {
  const calls: ExecRecord[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const layer = Layer.succeed(
    ToolService,
    ToolService.of({
      execute: (req: { toolName: string; arguments?: Record<string, unknown> }) =>
        Effect.gen(function* () {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          calls.push({
            toolName: req.toolName,
            args: req.arguments ?? {},
            inFlightAtStart: inFlight,
          });
          yield* Effect.sleep("15 millis");
          inFlight -= 1;
          return { success: true, result: `result-of-${req.toolName}` };
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

// ── Helpers ──────────────────────────────────────────────────────────────────

const schema = (name: string): ToolSchema => ({
  name,
  description: `${name} tool`,
  parameters: [{ name: "query", type: "string", description: "input", required: false }],
});

/** A plan turn (consumed by the planner's completeStructured). Fills the
 *  schema-required `instruction` field so hydratePlan produces valid steps. */
function planTurn(
  steps: ReadonlyArray<{
    title: string;
    type: "tool_call" | "analysis";
    toolName?: string;
    toolArgs?: Record<string, unknown>;
    dependsOn?: string[];
  }>,
): TestTurn {
  return {
    json: {
      steps: steps.map((s) => ({ instruction: `do ${s.title}`, ...s })),
    },
  };
}

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    taskDescription: "Find AI news then summarize it",
    taskType: "research",
    memoryContext: "",
    availableTools: ["web-search", "web-fetch"],
    availableToolSchemas: [schema("web-search"), schema("web-fetch")],
    config: defaultReasoningConfig,
    ...overrides,
  };
}

const localSequentialCalibration: ModelCalibration = {
  modelId: "ollama:qwen3:4b",
  calibratedAt: new Date().toISOString(),
  probeVersion: 1,
  runsAveraged: 3,
  steeringCompliance: "user-message",
  parallelCallCapability: "sequential-only",
  observationHandling: "needs-inline-facts",
  systemPromptAttention: "weak",
  optimalToolResultChars: 2000,
  toolCallDialect: "text-parse",
};

// ── (a) happy path ────────────────────────────────────────────────────────────

describe("blueprint — happy path", () => {
  it("plan→execute→solve produces a result with ~2 LLM calls", async () => {
    const { layer: toolLayer, calls } = makeRecordingToolService();
    const { layer: llmLayer, counts } = countingLLMLayer([
      // planner (completeStructured) — two independent tool steps
      planTurn([
        { title: "search", type: "tool_call", toolName: "web-search", toolArgs: { query: "ai news" } },
        { title: "fetch", type: "tool_call", toolName: "web-fetch", toolArgs: { query: "top result" } },
      ]),
      // solver (complete)
      { text: "Here is the synthesized AI news summary." },
    ]);

    const result = await Effect.runPromise(
      executeBlueprint(baseInput()).pipe(
        Effect.provide(Layer.mergeAll(toolLayer, llmLayer)),
      ),
    );

    expect(result.strategy).toBe("blueprint");
    expect(result.status).toBe("completed");
    expect(result.output).toContain("synthesized AI news summary");

    // ~2 LLM calls: 1 planner (completeStructured) + 1 solver (complete).
    expect(counts.completeStructured).toBe(1);
    expect(counts.complete).toBe(1);

    // Both tool steps actually dispatched by the 0-LLM worker.
    expect(calls.map((c) => c.toolName).sort()).toEqual(["web-fetch", "web-search"]);
  });

  it("runs the solver to synthesize when the plan declares an analysis step (no short-circuit)", async () => {
    // One tool_call + one analysis step: the planner explicitly asked for the
    // raw tool result to be transformed (e.g. "list them in a numbered list").
    // blueprint must NOT short-circuit on the single tool result — it must run
    // SOLVE so the declared synthesis actually happens.
    const { layer: toolLayer } = makeRecordingToolService();
    const { layer: llmLayer, counts } = countingLLMLayer([
      planTurn([
        { title: "fetch", type: "tool_call", toolName: "web-search", toolArgs: { query: "commits" } },
        { title: "format", type: "analysis", dependsOn: ["s1"] },
      ]),
      { text: "1. commit-a\n2. commit-b" },
    ]);

    const result = await Effect.runPromise(
      executeBlueprint(baseInput()).pipe(
        Effect.provide(Layer.mergeAll(toolLayer, llmLayer)),
      ),
    );

    expect(result.status).toBe("completed");
    // SOLVE ran — the synthesized list is the output, NOT the raw tool result.
    expect(counts.complete).toBe(1);
    expect(result.output).toBe("1. commit-a\n2. commit-b");
    expect(result.output).not.toContain("result-of-web-search");
  });

  it("skips the solver when a single step already produced the answer (short-circuit)", async () => {
    const { layer: toolLayer } = makeRecordingToolService();
    const { layer: llmLayer, counts } = countingLLMLayer([
      planTurn([
        { title: "search", type: "tool_call", toolName: "web-search", toolArgs: { query: "x" } },
      ]),
      { text: "should-not-be-called" },
    ]);

    const result = await Effect.runPromise(
      executeBlueprint(baseInput()).pipe(
        Effect.provide(Layer.mergeAll(toolLayer, llmLayer)),
      ),
    );

    expect(result.status).toBe("completed");
    expect(counts.completeStructured).toBe(1);
    // Single-substantive-step short-circuit → no solver call.
    expect(counts.complete).toBe(0);
    expect(result.output).toBe("result-of-web-search");
  });
});

// ── (b) invalid plan → degrade to reactive ──────────────────────────────────

describe("blueprint — degrade to reactive on invalid plan", () => {
  it("falls back to reactive when the plan has a dangling dependency", async () => {
    const { layer: toolLayer } = makeRecordingToolService();
    // Plan whose step depends on a non-existent step → verifyPlan "invalid".
    // Reactive then runs and emits a FINAL ANSWER.
    const { layer: llmLayer, counts } = countingLLMLayer([
      planTurn([
        {
          title: "fetch",
          type: "tool_call",
          toolName: "web-fetch",
          toolArgs: { query: "x" },
          dependsOn: ["s99"],
        },
      ]),
      // reactive's first turn → FINAL ANSWER
      { text: "FINAL ANSWER: reactive handled it." },
    ]);

    const result = await Effect.runPromise(
      executeBlueprint(baseInput({ availableTools: [] })).pipe(
        Effect.provide(Layer.mergeAll(toolLayer, llmLayer)),
      ),
    );

    // Degrade path runs reactive → result.strategy is "reactive", not blueprint.
    expect(result.strategy).toBe("reactive");
    expect(result.status).toBe("completed");
    expect(result.output).toContain("reactive handled it");
    // The planner was still called once before degrading.
    expect(counts.completeStructured).toBe(1);
  });
});

// ── (c) tier branch — local sequential-only → concurrency 1 ──────────────────

describe("blueprint — tier/capability concurrency branch", () => {
  it("runs the worker sequentially for a sequential-only local model", async () => {
    const { layer: toolLayer, getMaxInFlight } = makeRecordingToolService();
    const { layer: llmLayer } = countingLLMLayer([
      // Two independent parallel-safe steps that WOULD overlap at concurrency>1.
      planTurn([
        { title: "search a", type: "tool_call", toolName: "web-search", toolArgs: { query: "a" } },
        { title: "search b", type: "tool_call", toolName: "web-search", toolArgs: { query: "b" } },
      ]),
      { text: "combined summary" },
    ]);

    const result = await Effect.runPromise(
      executeBlueprint(
        baseInput({
          modelId: "ollama:qwen3:4b",
          calibration: localSequentialCalibration,
        }),
      ).pipe(Effect.provide(Layer.mergeAll(toolLayer, llmLayer))),
    );

    expect(result.status).toBe("completed");
    // sequential-only calibration → concurrency 1 → the two searches never overlap.
    expect(getMaxInFlight()).toBe(1);
  });

  it("fans out independent steps for a capable model (concurrency > 1)", async () => {
    const { layer: toolLayer, getMaxInFlight } = makeRecordingToolService();
    const { layer: llmLayer } = countingLLMLayer([
      planTurn([
        { title: "search a", type: "tool_call", toolName: "web-search", toolArgs: { query: "a" } },
        { title: "search b", type: "tool_call", toolName: "web-search", toolArgs: { query: "b" } },
      ]),
      { text: "combined summary" },
    ]);

    await Effect.runPromise(
      executeBlueprint(
        baseInput({ modelId: "claude-sonnet-4" }),
      ).pipe(Effect.provide(Layer.mergeAll(toolLayer, llmLayer))),
    );

    // No calibration cap + large tier → parallel fan-out; the two searches overlap.
    expect(getMaxInFlight()).toBeGreaterThanOrEqual(2);
  });
});

// ── (d) required-tool repair flows through ──────────────────────────────────

describe("blueprint — required-tool repair", () => {
  it("executes a synthetic step injected for a missing required tool", async () => {
    const { layer: toolLayer, calls } = makeRecordingToolService();
    const { layer: llmLayer } = countingLLMLayer([
      // Plan omits the required `file-write` tool → verifyPlan repairs it.
      planTurn([
        { title: "search", type: "tool_call", toolName: "web-search", toolArgs: { query: "x" } },
      ]),
      { text: "done" },
    ]);

    const result = await Effect.runPromise(
      executeBlueprint(
        baseInput({
          availableTools: ["web-search", "file-write"],
          availableToolSchemas: [schema("web-search"), schema("file-write")],
          requiredTools: ["file-write"],
        }),
      ).pipe(Effect.provide(Layer.mergeAll(toolLayer, llmLayer))),
    );

    expect(result.status).toBe("completed");
    // The injected synthetic file-write step was actually dispatched.
    expect(calls.some((c) => c.toolName === "file-write")).toBe(true);
    expect(calls.some((c) => c.toolName === "web-search")).toBe(true);
  });
});

// ── (e) execution-failure patch retry ───────────────────────────────────────
//
// The planner can emit a structurally-valid plan whose tool ARGUMENTS are wrong
// (the gh-cli "--limit" failure). VERIFY passes it (shape is fine); the tool
// errors at execution. blueprint must feed that error back via the existing
// patchPlan helper, re-run the (idempotent) worker once, and recover — instead
// of silently shipping empty output.

/** Tool service that FAILS when an arg value contains "bad", succeeds otherwise. */
function makeArgSensitiveToolService() {
  const calls: Array<{ toolName: string; args: Record<string, unknown> }> = [];
  const layer = Layer.succeed(
    ToolService,
    ToolService.of({
      execute: (req: { toolName: string; arguments?: Record<string, unknown> }) =>
        Effect.gen(function* () {
          const args = req.arguments ?? {};
          calls.push({ toolName: req.toolName, args });
          const bad = Object.values(args).some(
            (v) => typeof v === "string" && v.includes("bad"),
          );
          if (bad) {
            return { success: false, result: `tool ${req.toolName} failed: invalid argument` };
          }
          return { success: true, result: `result-of-${req.toolName}` };
        }),
      getTool: (name: string) =>
        Effect.succeed({ name, description: "t", parameters: [{ name: "query", type: "string", required: true }] }),
      register: () => Effect.void,
      listTools: () => Effect.succeed([]),
      deregister: () => Effect.void,
    } as unknown as Parameters<typeof ToolService.of>[0]),
  );
  return { calls, layer };
}

describe("blueprint — execution-failure patch retry", () => {
  it("patches a failed tool step's args and recovers (no empty output)", async () => {
    const { layer: toolLayer, calls } = makeArgSensitiveToolService();
    const { layer: llmLayer, counts } = countingLLMLayer([
      // initial plan — args are wrong, the tool will error.
      planTurn([
        { title: "search", type: "tool_call", toolName: "web-search", toolArgs: { query: "bad-args" } },
      ]),
      // patch — corrected args (no "bad" marker) → tool succeeds.
      planTurn([
        { title: "search-fixed", type: "tool_call", toolName: "web-search", toolArgs: { query: "good-args" } },
      ]),
    ]);

    const result = await Effect.runPromise(
      executeBlueprint(baseInput()).pipe(
        Effect.provide(Layer.mergeAll(toolLayer, llmLayer)),
      ),
    );

    // Recovered — NOT an empty-output partial failure.
    expect(result.status).toBe("completed");
    expect(result.output).toBe("result-of-web-search");
    // Tool dispatched twice: the failing original + the patched retry.
    expect(calls.length).toBe(2);
    expect(calls[0]!.args.query).toBe("bad-args");
    expect(calls[1]!.args.query).toBe("good-args");
    // Two structured calls: the initial plan + one patch. Bounded — not a loop.
    expect(counts.completeStructured).toBe(2);
  });

  it("degrades to reactive when the patch retry still fails (zero completed)", async () => {
    const { layer: toolLayer } = makeArgSensitiveToolService();
    const { layer: llmLayer } = countingLLMLayer([
      // initial plan — bad args.
      planTurn([
        { title: "search", type: "tool_call", toolName: "web-search", toolArgs: { query: "bad-1" } },
      ]),
      // patch — STILL bad args → tool errors again, zero completed.
      planTurn([
        { title: "search", type: "tool_call", toolName: "web-search", toolArgs: { query: "bad-2" } },
      ]),
      // reactive fallback final answer.
      { text: "FINAL ANSWER: reactive recovered." },
    ]);

    const result = await Effect.runPromise(
      executeBlueprint(baseInput()).pipe(
        Effect.provide(Layer.mergeAll(toolLayer, llmLayer)),
      ),
    );

    // After bounded patch-retry produced nothing usable, degrade to reactive.
    expect(result.strategy).toBe("reactive");
    expect(result.output).toContain("reactive recovered");
  });
});
