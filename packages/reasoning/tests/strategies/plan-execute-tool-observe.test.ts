// File: tests/strategies/plan-execute-tool-observe.test.ts
//
// Phase C of the canonical tool-execution plan (#195 / FM-I).
//
// plan-execute's `tool_call` branch hand-rolled a direct ToolService dispatch
// that NEVER emitted the `observation.tool-result` Compose tag — so `.on()` /
// `.tap()` hooks registered on a plan-execute-reflect agent were dead for tool
// steps. After routing the branch through `executeToolAndObserve`, the tag
// fires identically to the kernel act path, healing applies, and observation
// metadata is guaranteed. The verifier + semantic-memory enrichments stay OFF
// (parity-cheap opt-out).
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { LLMService, TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { ToolService } from "@reactive-agents/tools";
import { HarnessPipeline, RegistrationHarness } from "@reactive-agents/core";
import { executePlanExecute } from "../../src/strategies/plan-execute.js";
import { defaultReasoningConfig } from "../../src/types/config.js";

/** Minimal ReasoningStep-ish shape the observation.tool-result tap receives. */
interface ObsStepLike {
  readonly type: string;
  readonly metadata?: {
    readonly toolCallId?: string;
    readonly verification?: unknown;
    readonly observationResult?: { readonly toolName?: string; readonly success?: boolean };
  };
}

/**
 * Stub ToolService that records every executed tool name (so the healing test
 * can assert the misspelled name was repaired before dispatch) and exposes a
 * `web-search` schema so the HealingPipeline has a fuzzy-match target.
 */
function makeRecordingToolService() {
  const executed: string[] = [];
  const layer = Layer.succeed(
    ToolService,
    ToolService.of({
      execute: (req: { toolName: string }) => {
        executed.push(req.toolName);
        return Effect.succeed({
          success: true,
          result: { results: [{ title: "hit", url: "https://example.com", content: "data" }] },
        });
      },
      getTool: (name: string) =>
        Effect.succeed({
          name,
          description: "test tool",
          parameters: [{ name: "query", type: "string", required: true }],
        }),
      register: () => Effect.void,
      listTools: () => Effect.succeed([]),
      deregister: () => Effect.void,
    } as unknown as Parameters<typeof ToolService.of>[0]),
  );
  return { executed, layer };
}

/** Recording pipeline — taps observation.tool-result + lifecycle.failure. */
function recordingPipeline() {
  const observations: ObsStepLike[] = [];
  const rh = new RegistrationHarness();
  rh.tap("observation.tool-result", (step: ObsStepLike) => {
    observations.push(step);
  });
  return { pipeline: new HarnessPipeline(rh._collected), observations };
}

/** web-search schema the planner/heal config sees. */
const WEB_SEARCH_SCHEMA = {
  name: "web-search",
  description: "Search the web",
  parameters: [{ name: "query", type: "string", description: "query", required: true }],
};

function planJson(toolName: string): string {
  return JSON.stringify({
    steps: [
      {
        title: "Search",
        instruction: "search the web",
        type: "tool_call",
        toolName,
        toolArgs: { query: "test" },
        rationale: { why: "need data", confidence: 0.9 },
      },
      { title: "Summarize", instruction: "summarize the result", type: "analysis" },
    ],
  });
}

/** LLM turns for a tool_call + analysis plan through reflection + synthesis. */
function planExecuteTurns(toolName: string) {
  return TestLLMServiceLayer([
    { match: "planning agent", text: planJson(toolName) },
    { match: "OVERALL GOAL", text: "FINAL ANSWER: summary done." },
    { match: "GOAL:", text: "SATISFIED: complete." },
    { match: "Synthesize", text: "Final synthesized answer." },
  ]);
}

const baseInput = {
  taskDescription: "Find test data",
  taskType: "simple",
  memoryContext: "",
  availableTools: ["web-search"] as string[],
  availableToolSchemas: [WEB_SEARCH_SCHEMA],
  config: defaultReasoningConfig,
};

describe("plan-execute tool_call → executeToolAndObserve (#195)", () => {
  it("fires observation.tool-result for a tool_call step", async () => {
    const { pipeline, observations } = recordingPipeline();
    const { layer: toolLayer } = makeRecordingToolService();

    const result = await Effect.runPromise(
      executePlanExecute({ ...baseInput, harnessPipeline: pipeline }).pipe(
        Effect.provide(Layer.merge(planExecuteTurns("web-search"), toolLayer)),
      ),
    );

    expect(result.status).toBe("completed");
    // BUG (#195): currently 0 — the tool_call branch never emits the tag.
    expect(observations.length).toBeGreaterThanOrEqual(1);
    const obs = observations[0]!;
    expect(obs.type).toBe("observation");
    expect(obs.metadata?.observationResult?.toolName).toBe("web-search");
    expect(obs.metadata?.observationResult?.success).toBe(true);
  });

  it("applies healing — a misspelled tool name is repaired before dispatch", async () => {
    const { pipeline } = recordingPipeline();
    const { executed, layer: toolLayer } = makeRecordingToolService();

    const result = await Effect.runPromise(
      executePlanExecute({ ...baseInput, harnessPipeline: pipeline }).pipe(
        Effect.provide(Layer.merge(planExecuteTurns("websearch"), toolLayer)),
      ),
    );

    expect(result.status).toBe("completed");
    // Healing fuzzy-matches "websearch" → "web-search" before ToolService.execute.
    expect(executed).toContain("web-search");
  });

  it("opt-outs hold — no verifier metadata, no MemoryService required", async () => {
    const { pipeline, observations } = recordingPipeline();
    const { layer: toolLayer } = makeRecordingToolService();

    // No MemoryService layer is provided; the run must resolve regardless
    // (semantic-memory store is OFF for plan-execute tool_call).
    const result = await Effect.runPromise(
      executePlanExecute({ ...baseInput, harnessPipeline: pipeline }).pipe(
        Effect.provide(Layer.merge(planExecuteTurns("web-search"), toolLayer)),
      ),
    );

    expect(result.status).toBe("completed");
    expect(observations.length).toBeGreaterThanOrEqual(1);
    expect(observations[0]!.metadata?.verification).toBeUndefined();
  });
});
