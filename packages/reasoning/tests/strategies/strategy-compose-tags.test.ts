// File: tests/strategies/strategy-compose-tags.test.ts
//
// Confirms observation.tool-result fires end-to-end through a strategy's
// orchestration (not just the handleActing unit) — proving the canonical
// executeToolAndObserve emit reaches external .on()/.tap() observers when a
// strategy executes a tool. reactive is the kernel single-tool path; the
// kernel-driven heavy strategies (reflexion/ToT/adaptive) route tools through
// the SAME act phase (verified: zero toolService.execute in those files), so
// this + the FM-I before('think') threading tests + the live multi-strategy
// probe together cover every strategy.
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { ToolService } from "@reactive-agents/tools";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { HarnessPipeline, RegistrationHarness } from "@reactive-agents/core";
import { executeReactive } from "../../src/strategies/reactive.js";
import { defaultReasoningConfig } from "../../src/types/config.js";

interface ObsStepLike {
  readonly type: string;
  readonly metadata?: {
    readonly observationResult?: { readonly toolName?: string; readonly success?: boolean };
  };
}

const TOOL_SCHEMA = {
  name: "web-search",
  description: "Search the web",
  parameters: [{ name: "query", type: "string", description: "query", required: true }],
};

function toolLayer() {
  const layer = Layer.succeed(
    ToolService,
    ToolService.of({
      execute: () =>
        Effect.succeed({
          success: true,
          result: { results: [{ title: "hit", url: "https://example.com", content: "data" }] },
        }),
      getTool: (name: string) =>
        Effect.succeed({ name, description: "t", parameters: [{ name: "query", type: "string", required: true }] }),
      register: () => Effect.void,
      listTools: () => Effect.succeed([]),
      deregister: () => Effect.void,
    } as unknown as Parameters<typeof ToolService.of>[0]),
  );
  return layer;
}

function recordingPipeline() {
  const observations: ObsStepLike[] = [];
  const rh = new RegistrationHarness();
  rh.tap("observation.tool-result", (step: ObsStepLike) => {
    observations.push(step);
  });
  return { pipeline: new HarnessPipeline(rh._collected), observations };
}

describe("compose observation.tool-result fires through strategy orchestration", () => {
  it("reactive: tool execution emits observation.tool-result to .tap()", async () => {
    const { pipeline, observations } = recordingPipeline();
    const llm = TestLLMServiceLayer([
      { toolCall: { name: "web-search", args: { query: "x" } } },
      { text: "FINAL ANSWER: done" },
    ]);

    const result = await Effect.runPromise(
      executeReactive({
        taskDescription: "search and finish",
        taskType: "simple",
        memoryContext: "",
        availableTools: ["web-search"],
        availableToolSchemas: [TOOL_SCHEMA],
        config: defaultReasoningConfig,
        harnessPipeline: pipeline,
      }).pipe(Effect.provide(Layer.merge(llm, toolLayer()))),
    );

    expect(result.status).toBe("completed");
    expect(observations.length).toBeGreaterThanOrEqual(1);
    expect(observations[0]!.type).toBe("observation");
    expect(observations[0]!.metadata?.observationResult?.toolName).toBe("web-search");
    expect(observations[0]!.metadata?.observationResult?.success).toBe(true);
  });
});
