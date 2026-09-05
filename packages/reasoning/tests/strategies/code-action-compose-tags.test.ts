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
import { EventBus, EventBusLive, HarnessPipeline, RegistrationHarness } from "@reactive-agents/core";
import { executeCodeAction } from "../../src/strategies/code-action.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { provideTestEnvelope } from "../../src/kernel/envelope/run-envelope.js";

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

    const result = await Effect.runPromise(provideTestEnvelope(
      executeCodeAction({
        taskDescription: "search and finish",
        taskType: "simple",
        memoryContext: "",
        availableTools: ["search"],
        availableToolSchemas: [TOOL_SCHEMA],
        config: defaultReasoningConfig,
        harnessPipeline: pipeline,
      }).pipe(Effect.provide(Layer.merge(llm, toolLayer()))),
    ));

    expect(result.status).toBe("completed");
    expect(observations.length).toBeGreaterThanOrEqual(1);
    expect(observations[0]!.type).toBe("observation");
    expect(observations[0]!.metadata?.observationResult?.toolName).toBe("search");
  }, 15000);

  it("publishes detailed reasoning steps for live progress logging", async () => {
    const events: Array<{ readonly _tag?: string; readonly thought?: string; readonly action?: string; readonly observation?: string }> = [];
    const llm = TestLLMServiceLayer([
      { text: "```typescript\n(async () => { return await search({ query: 'x' }); })()\n```" },
    ]);

    const result = await Effect.runPromise(provideTestEnvelope(
      Effect.gen(function* () {
        const eventBus = yield* EventBus;
        const unsubscribe = yield* eventBus.subscribe((event) => {
          events.push(event);
          return Effect.void;
        });
        const result = yield* executeCodeAction({
          taskDescription: "search and finish",
          taskType: "simple",
          memoryContext: "",
          availableTools: ["search"],
          availableToolSchemas: [TOOL_SCHEMA],
          config: defaultReasoningConfig,
        }).pipe(Effect.provide(Layer.merge(llm, toolLayer())));
        unsubscribe();
        return result;
      }).pipe(Effect.provide(EventBusLive)),
    ));

    expect(result.status).toBe("completed");
    const reasoningSteps = events.filter((event) => event._tag === "ReasoningStepCompleted");
    expect(reasoningSteps.some((event) => event.thought?.includes("Plan: generating code"))).toBe(true);
    expect(reasoningSteps.some((event) => event.action?.includes("search"))).toBe(true);
    expect(reasoningSteps.some((event) => event.observation?.includes("search result"))).toBe(true);
  }, 15000);
});
