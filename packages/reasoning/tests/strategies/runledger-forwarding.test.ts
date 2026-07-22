// File: tests/strategies/runledger-forwarding.test.ts
//
// Wave C.1 ledger-convergence, Task 4 — B2-class boundary pin: every strategy
// forwards the run's ledger as `extraMetadata.runLedger`. Without this, the
// engine's receipt re-base (Slice 2 helpers.ts) silently falls back to
// step-scanning for the strategies that "forgot" — the exact write-only-
// boundary disease already killed for `terminatedBy` (see
// terminatedby-abstention-boundary.test.ts, the harness this file mirrors).
//
// Harness (copied verbatim in spirit from terminatedby-abstention-boundary.test.ts
// + strategy-tool-ledger.test.ts + blueprint.test.ts): TestLLMService(Layer)
// deterministic provider, a minimal always-succeed ToolService, one tool call
// per run. Each `it` drives ONE strategy to execute a real tool, then asserts
// the canonical shape on `result.metadata.runLedger`.
//
// RED-ON-CUT: delete the `runLedger: state.ledger ?? []` (or equivalent) line
// from any of the 6 kernel-strategy result sites and that strategy's
// assertion goes red — `runLedger` is undefined (engine falls back to
// step-scanning, silently, for that strategy only).
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { LLMService, TestLLMService, TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { ToolService } from "@reactive-agents/tools";
import { executeReactive } from "../../src/strategies/reactive.js";
import { executeDirect } from "../../src/strategies/direct.js";
import { executeReflexion } from "../../src/strategies/reflexion.js";
import { executeTreeOfThought } from "../../src/strategies/tree-of-thought.js";
import { executeCodeAction } from "../../src/strategies/code-action.js";
import { executeAdaptive } from "../../src/strategies/adaptive.js";
import { executePlanExecute } from "../../src/strategies/plan-execute.js";
import { executeBlueprint } from "../../src/strategies/blueprint.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { succeedingToolLayer } from "../../src/testing/tool-service-mock.js";
import type { ReasoningResult } from "../../src/types/index.js";

// ── Shared assertion ─────────────────────────────────────────────────────────

/** The deliverable per the brief: runLedger is defined, an array, and (for a
 *  run that executed ≥1 tool) carries at least one tool-invocation entry. */
function expectRunLedgerForwarded(result: ReasoningResult) {
  const meta = result.metadata as unknown as Record<string, unknown>;
  expect(meta.runLedger).toBeDefined();
  expect(Array.isArray(meta.runLedger)).toBe(true);
  const kinds = (meta.runLedger as { kind: string }[]).map((e) => e.kind);
  expect(kinds).toContain("tool-invocation");
}

// ── Fixture set A: reactive / direct / tree-of-thought (skip path) / adaptive ──
//
// A single-tool-call trivial task. "trivial" (task-complexity.ts rule 4: short
// prose, ≤12 words / ≤80 chars) drives ToT's cost-gated BFS-skip (delegates to
// the SAME react kernel reactive/direct use) and adaptive's HS-111 cost-class
// gate (trivial → reactive, no LLM classification call, no fallback).

const TASK_TRIVIAL = "Gather the key fact about the topic.";

const GATHER_SCHEMA = {
  name: "gather",
  description: "gather research data",
  parameters: [{ name: "q", type: "string", description: "query", required: true }],
};

const gatherToolLayer = succeedingToolLayer(
  { finding: "KEY FACT: the topic's core metric rose 12% last quarter." },
  GATHER_SCHEMA.parameters,
);

/** Positional (no `match` guard) scenario: turn 0 always fires on the first
 *  call, turn 1 repeats for every call after — one real tool call, then a
 *  final answer, regardless of exact prompt content. */
const gatherScenario = () =>
  TestLLMServiceLayer([
    { toolCall: { name: "gather", args: { q: "topic" } } },
    { text: "FINAL ANSWER: the topic's core metric rose 12% last quarter." },
  ]);

// ── Fixture set B: reflexion / code-action / plan-execute / blueprint ────────
//
// A file-write deliverable task — mirrors strategy-tool-ledger.test.ts /
// blueprint.test.ts's canonical-tool-ledger fixtures exactly (same harness,
// same task, same tool), so plan-execute/blueprint (already forwarding
// runLedger — Wave C task C8) are proven to still pass unchanged.

const TASK_FILE = "Research the topic and save the summary to local file ./out.md";

const FILE_WRITE_SCHEMA = {
  name: "file-write",
  description: "Write a file",
  parameters: [
    { name: "path", type: "string", description: "target path", required: true },
    { name: "content", type: "string", description: "file content", required: true },
  ],
};

function makeFileWriteToolLayer() {
  return Layer.succeed(
    ToolService,
    ToolService.of({
      execute: (req: { toolName: string; arguments?: Record<string, unknown> }) =>
        Effect.succeed({ success: true, result: `wrote ${String(req.arguments?.path ?? "")}` }),
      getTool: (name: string) =>
        Effect.succeed({
          name,
          description: "test tool",
          parameters: FILE_WRITE_SCHEMA.parameters,
        }),
      register: () => Effect.void,
      listTools: () => Effect.succeed([]),
      deregister: () => Effect.void,
    } as unknown as Parameters<typeof ToolService.of>[0]),
  );
}

/** Reflexion: generate sub-kernel's first turn emits a native file-write tool
 *  call, second turn ships the final answer, critique(s) after that see
 *  SATISFIED (TestLLMService repeats the last turn once the scenario is
 *  exhausted). Identical to strategy-tool-ledger.test.ts. */
function makeReflexionToolCallingLLMLayer() {
  return Layer.succeed(
    LLMService,
    LLMService.of(
      TestLLMService([
        {
          toolCalls: [
            { id: "tc-ledger-1", name: "file-write", args: { path: "./out.md", content: "the summary" } },
          ],
        },
        { text: "Saved the summary to ./out.md." },
        { text: "SATISFIED: the response fully addresses the task." },
      ]),
    ),
  );
}

/** plan-execute: the planner turn emits one file-write tool_call step; later
 *  completions are plain-text answers. Identical to strategy-tool-ledger.test.ts. */
function makePlanExecuteLLMLayer() {
  return Layer.succeed(
    LLMService,
    LLMService.of(
      TestLLMService([
        {
          json: {
            steps: [
              {
                instruction: "write the summary file",
                title: "write summary",
                type: "tool_call",
                toolName: "file-write",
                toolArgs: { path: "./out.md", content: "the summary" },
              },
            ],
          },
        },
        { text: "Saved the summary to ./out.md." },
        { text: "Saved the summary to ./out.md." },
        { text: "Saved the summary to ./out.md." },
      ]),
    ),
  );
}

/** blueprint: planner (completeStructured) emits one file-write tool_call
 *  step; solver (complete) ships the final answer. Mirrors blueprint.test.ts's
 *  "canonical tool ledger (deliverable truth)" fixture. */
function makeBlueprintLLMLayer() {
  return Layer.succeed(
    LLMService,
    LLMService.of(
      TestLLMService([
        {
          json: {
            steps: [
              {
                instruction: "write summary",
                title: "write summary",
                type: "tool_call",
                toolName: "file-write",
                toolArgs: { path: "./out.md", content: "hello" },
              },
            ],
          },
        },
        { text: "done" },
      ]),
    ),
  );
}

/** code-action: sandbox-executed JS code that calls the bound file_write tool.
 *  Identical to strategy-tool-ledger.test.ts. */
const CODE_ACTION_SOURCE = [
  "```javascript",
  '(async () => { await file_write({ path: "./out.md", content: "the summary" }); return "done"; })()',
  "```",
].join("\n");

describe("Task 4 — every strategy forwards extraMetadata.runLedger", () => {
  it("reactive: forwards the kernel's ledger with a tool-invocation entry", async () => {
    const result = await Effect.runPromise(
      executeReactive({
        taskDescription: TASK_TRIVIAL,
        taskType: "research",
        memoryContext: "",
        availableTools: ["gather"],
        availableToolSchemas: [GATHER_SCHEMA],
        config: defaultReasoningConfig,
      } as never).pipe(Effect.provide(Layer.merge(gatherScenario(), gatherToolLayer))),
    );
    expectRunLedgerForwarded(result);
  }, 15000);

  it("direct: forwards the kernel's ledger with a tool-invocation entry", async () => {
    const result = await Effect.runPromise(
      executeDirect({
        taskDescription: TASK_TRIVIAL,
        taskType: "research",
        memoryContext: "",
        availableTools: ["gather"],
        availableToolSchemas: [GATHER_SCHEMA],
        config: defaultReasoningConfig,
        maxIterations: 2,
      } as never).pipe(Effect.provide(Layer.merge(gatherScenario(), gatherToolLayer))),
    );
    expectRunLedgerForwarded(result);
  }, 15000);

  it("reflexion: forwards the terminal pass's ledger with a tool-invocation entry", async () => {
    const result = await Effect.runPromise(
      executeReflexion({
        taskDescription: TASK_FILE,
        taskType: "general",
        memoryContext: "",
        availableTools: ["file-write"],
        availableToolSchemas: [FILE_WRITE_SCHEMA],
        config: defaultReasoningConfig,
      } as never).pipe(
        Effect.provide(Layer.mergeAll(makeReflexionToolCallingLLMLayer(), makeFileWriteToolLayer())),
      ),
    );
    expectRunLedgerForwarded(result);
  }, 15000);

  it("tree-of-thought: forwards the skip-path kernel's ledger with a tool-invocation entry", async () => {
    const result = await Effect.runPromise(
      executeTreeOfThought({
        taskDescription: TASK_TRIVIAL,
        taskType: "research",
        memoryContext: "",
        availableTools: ["gather"],
        availableToolSchemas: [GATHER_SCHEMA],
        config: defaultReasoningConfig,
      } as never).pipe(Effect.provide(Layer.merge(gatherScenario(), gatherToolLayer))),
    );
    expectRunLedgerForwarded(result);
  }, 15000);

  it("code-action: forwards a steps-derived ledger with a tool-invocation entry", async () => {
    const result = (await Effect.runPromise(
      executeCodeAction({
        taskDescription: TASK_FILE,
        taskType: "general",
        memoryContext: "",
        availableTools: ["file-write"],
        availableToolSchemas: [FILE_WRITE_SCHEMA],
        config: defaultReasoningConfig,
      } as never).pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(LLMService, LLMService.of(TestLLMService([{ text: CODE_ACTION_SOURCE }]))),
            makeFileWriteToolLayer(),
          ),
        ),
      ),
    )) as ReasoningResult;
    expectRunLedgerForwarded(result);
  }, 15000);

  it("adaptive: forwards the dispatched sub-strategy's (reactive) ledger", async () => {
    const result = await Effect.runPromise(
      executeAdaptive({
        taskDescription: TASK_TRIVIAL,
        taskType: "research",
        memoryContext: "",
        availableTools: ["gather"],
        availableToolSchemas: [GATHER_SCHEMA],
        config: defaultReasoningConfig,
      } as never).pipe(Effect.provide(Layer.merge(gatherScenario(), gatherToolLayer))),
    );
    // Sanity: the trivial-task cost gate routed to reactive with no fallback —
    // otherwise this would be pinning the wrong sub-strategy's ledger.
    const meta = result.metadata as unknown as Record<string, unknown>;
    expect(meta.selectedStrategy).toBe("reactive");
    expect(meta.fallbackOccurred).toBe(false);
    expectRunLedgerForwarded(result);
  }, 15000);

  it("plan-execute: already forwards runLedger (Wave C task C8) — unchanged by Task 4", async () => {
    const result = await Effect.runPromise(
      executePlanExecute({
        taskDescription: TASK_FILE,
        taskType: "general",
        memoryContext: "",
        availableTools: ["file-write"],
        availableToolSchemas: [FILE_WRITE_SCHEMA],
        config: defaultReasoningConfig,
      } as never).pipe(Effect.provide(Layer.mergeAll(makePlanExecuteLLMLayer(), makeFileWriteToolLayer()))),
    );
    expectRunLedgerForwarded(result);
  }, 15000);

  it("blueprint: already forwards runLedger (Wave C task C8) — unchanged by Task 4", async () => {
    const result = await Effect.runPromise(
      executeBlueprint({
        taskDescription: TASK_FILE,
        taskType: "general",
        memoryContext: "",
        availableTools: ["file-write"],
        availableToolSchemas: [FILE_WRITE_SCHEMA],
        config: defaultReasoningConfig,
      } as never).pipe(Effect.provide(Layer.mergeAll(makeBlueprintLLMLayer(), makeFileWriteToolLayer()))),
    );
    expectRunLedgerForwarded(result);
  }, 15000);
});
