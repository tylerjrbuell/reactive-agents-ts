// Run: bun test packages/reasoning/tests/strategies/code-action-compose-tags.test.ts --timeout 15000
//
// FM-I (#195): code-action executes tools inside the sandbox Worker, NOT through
// the kernel act phase, so the canonical executeToolAndObserve emit never reached
// it. This proves observation.tool-result now fires to external .on()/.tap()
// observers for code-action tool calls — closing the last strategy in the #195
// field-drop matrix.
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { ToolService } from "@reactive-agents/tools";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { HarnessPipeline, RegistrationHarness } from "@reactive-agents/core";
import { executeCodeAction } from "../../src/strategies/code-action.js";
import { defaultReasoningConfig } from "../../src/types/config.js";

interface ObsStepLike {
  readonly type: string;
  readonly metadata?: {
    readonly observationResult?: { readonly toolName?: string; readonly success?: boolean };
  };
}

const TOOL_SCHEMA = {
  name: "search",
  description: "Search the web",
  parameters: [{ name: "query", type: "string", description: "query", required: true }],
};

function toolLayer() {
  return Layer.succeed(
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
}

function recordingPipeline() {
  const observations: ObsStepLike[] = [];
  const rh = new RegistrationHarness();
  rh.tap("observation.tool-result", (step: ObsStepLike) => {
    observations.push(step);
  });
  return { pipeline: new HarnessPipeline(rh._collected), observations };
}

describe("code-action emits observation.tool-result for sandbox tool calls (#195)", () => {
  it("fires observation.tool-result to .tap() for each sandbox tool call", async () => {
    const { pipeline, observations } = recordingPipeline();
    // The plan LLM returns a code block that calls the bound `search` tool.
    const llm = TestLLMServiceLayer([
      { text: "```typescript\n(async () => { return await search({ query: 'x' }); })()\n```" },
    ]);

    const result = await Effect.runPromise(
      executeCodeAction({
        taskDescription: "search and finish",
        taskType: "simple",
        memoryContext: "",
        availableTools: ["search"],
        availableToolSchemas: [TOOL_SCHEMA],
        config: defaultReasoningConfig,
        harnessPipeline: pipeline,
      }).pipe(Effect.provide(Layer.merge(llm, toolLayer()))),
    );

    expect(result.status).toBe("completed");
    expect(observations.length).toBeGreaterThanOrEqual(1);
    expect(observations[0]!.type).toBe("observation");
    expect(observations[0]!.metadata?.observationResult?.toolName).toBe("search");
  }, 15000);
});
