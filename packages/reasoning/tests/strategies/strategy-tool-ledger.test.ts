// Run: bun test packages/reasoning/tests/strategies/strategy-tool-ledger.test.ts --timeout 20000
//
// Canonical tool ledger — deliverable truth across strategy boundaries.
//
// Empirical origin (2026-07-11, gemma4 scratch runs 01KX998PS2X3NW7JTAKBJMWPGN
// blueprint / 01KX99T53WSFS1TW08KAHR89SR reflexion): the agent wrote ./show.md
// via file-write (tool ok, file on disk) yet the receipt reported
// `deliverables[0].produced: false`. Each strategy flattened its tool evidence
// into prose-only steps ("[EXEC s4] ✓ …") or dropped the sub-kernel ledger
// entirely, so `isArtifactProduced`'s toolCallId linkage (action step with
// metadata.toolCall ←→ observation step with toolCallId + observationResult)
// could never match. These tests pin that every strategy's result.steps carry
// the canonical pair, end-to-end through computeDeliverableReport.
//
// (blueprint's pin lives in blueprint.test.ts — same describe pattern.)
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { LLMService, TestLLMService } from "@reactive-agents/llm-provider";
import { ToolService } from "@reactive-agents/tools";
import { executeReflexion } from "../../src/strategies/reflexion.js";
import { executePlanExecute } from "../../src/strategies/plan-execute.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { compileRunContract } from "../../src/kernel/contract/run-contract.js";
import { computeDeliverableReport } from "../../src/kernel/contract/deliverable-report.js";
import type { ReasoningResult } from "../../src/types/index.js";

const TASK = "Research the topic and save the summary to local file ./out.md";

const FILE_WRITE_SCHEMA = {
  name: "file-write",
  description: "Write a file",
  parameters: [
    { name: "path", type: "string", description: "target path", required: true },
    { name: "content", type: "string", description: "file content", required: true },
  ],
};

function makeToolLayer() {
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

/**
 * Ordered scenario: the generate sub-kernel's first turn emits a native
 * file-write tool call, its second turn ships the final answer, and every call
 * after that (critique / gates) sees SATISFIED — TestLLMService repeats the
 * last turn when the scenario is exhausted.
 */
function makeToolCallingLLMLayer() {
  return Layer.succeed(
    LLMService,
    LLMService.of(
      TestLLMService([
        {
          toolCalls: [
            {
              id: "tc-ledger-1",
              name: "file-write",
              args: { path: "./out.md", content: "the summary" },
            },
          ],
        },
        { text: "Saved the summary to ./out.md." },
        { text: "SATISFIED: the response fully addresses the task." },
      ]),
    ),
  );
}

/** Shared assertion: the canonical pair exists and the deliverable verifies. */
function expectLedgerTruth(result: ReasoningResult) {
  const action = result.steps.find(
    (s) => s.type === "action" && s.metadata?.toolCall?.name === "file-write",
  );
  expect(action).toBeDefined();
  const obs = result.steps.find(
    (s) =>
      s.type === "observation" &&
      s.metadata?.toolCallId === action?.metadata?.toolCall?.id &&
      s.metadata?.observationResult?.success === true,
  );
  expect(obs).toBeDefined();

  const contract = compileRunContract(TASK, {});
  const report = computeDeliverableReport(contract, result.steps, String(result.output ?? ""));
  expect(report.length).toBeGreaterThanOrEqual(1);
  expect(report.every((r) => r.produced)).toBe(true);
}

describe("strategy tool ledger — deliverable truth", () => {
  it("reflexion: sub-kernel file-write evidence reaches result.steps and verifies produced", async () => {
    const result = await Effect.runPromise(
      executeReflexion({
        taskDescription: TASK,
        taskType: "general",
        memoryContext: "",
        availableTools: ["file-write"],
        availableToolSchemas: [FILE_WRITE_SCHEMA],
        config: defaultReasoningConfig,
      } as never).pipe(Effect.provide(Layer.mergeAll(makeToolCallingLLMLayer(), makeToolLayer()))),
    );
    expectLedgerTruth(result);
  }, 20000);

  it("plan-execute: dispatched file-write evidence reaches result.steps and verifies produced", async () => {
    const result = await Effect.runPromise(
      executePlanExecute({
        taskDescription: TASK,
        taskType: "general",
        memoryContext: "",
        availableTools: ["file-write"],
        availableToolSchemas: [FILE_WRITE_SCHEMA],
        config: defaultReasoningConfig,
      } as never).pipe(Effect.provide(Layer.mergeAll(makePlanExecuteLLMLayer(), makeToolLayer()))),
    );
    expectLedgerTruth(result);
  }, 20000);
});

/**
 * Mock LLM for plan-execute: the planner turn emits one file-write tool_call
 * step (TestLLMService json turn); later completions are plain text answers.
 */
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
