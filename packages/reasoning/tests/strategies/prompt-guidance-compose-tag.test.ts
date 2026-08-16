// File: tests/strategies/prompt-guidance-compose-tag.test.ts
//
// Live-QA audit (2026-08-16): of the 9 harness-authored "Guidance:" text
// channels folded into the system prompt each turn (required-tools
// reminders, oracle/ICS nudges, error-recovery, the post-tool-call finish
// nudge, quality-gate hints, evidence-gap redirects), only `loopDetected`
// had ANY compose override point before this — the other 8 were pure
// hardcoded text, contradicting the framework's own "no black-box agents"
// design goal. This confirms the new `prompt.guidance` tag actually fires
// through a real strategy execution (think.ts), not just the pipeline
// mechanics in isolation (see packages/core/tests/harness-pipeline.test.ts).
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { ToolService } from "@reactive-agents/tools";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { HarnessPipeline, RegistrationHarness } from "@reactive-agents/core";
import { executeReactive } from "../../src/strategies/reactive.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { provideTestEnvelope } from "../../src/kernel/envelope/run-envelope.js";

const TOOL_SCHEMA = {
  name: "web-search",
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

describe("compose prompt.guidance fires through real strategy orchestration", () => {
  it("a .tap('prompt.guidance', ...) observes the rendered guidance value on a real think() call", async () => {
    const observed: Array<string | null> = [];
    const rh = new RegistrationHarness();
    rh.tap("prompt.guidance", (value: string | null) => {
      observed.push(value);
    });
    const pipeline = new HarnessPipeline(rh._collected);

    const llm = TestLLMServiceLayer([
      { toolCall: { name: "web-search", args: { query: "x" } } },
      { text: "FINAL ANSWER: done" },
    ]);

    const result = await Effect.runPromise(provideTestEnvelope(
      executeReactive({
        taskDescription: "search and finish",
        taskType: "simple",
        memoryContext: "",
        availableTools: ["web-search"],
        availableToolSchemas: [TOOL_SCHEMA],
        config: defaultReasoningConfig,
        harnessPipeline: pipeline,
      }).pipe(Effect.provide(Layer.merge(llm, toolLayer()))),
    ));

    expect(result.status).toBe("completed");
    // think.ts calls transform('prompt.guidance', ...) on every iteration
    // when a harnessPipeline is wired, regardless of whether any natural
    // guidance signal is active this turn (default is `null` in that case).
    expect(observed.length).toBeGreaterThanOrEqual(1);
  });

  it("a .on('prompt.guidance', ...) transform can inject text even when no natural guidance signal is active", async () => {
    const OVERRIDE = "CUSTOM: always remind the model to cite sources.";
    const observed: Array<string | null> = [];
    const rh = new RegistrationHarness();
    rh.on("prompt.guidance", () => OVERRIDE);
    // Also tap to confirm the override value is what actually renders —
    // proves .on() results flow all the way through, not just .tap()
    // observing the pre-existing default. Registered before the pipeline is
    // constructed — HarnessPipeline snapshots registrations at construction.
    rh.tap("prompt.guidance", (value: string | null) => {
      observed.push(value);
    });
    const pipeline = new HarnessPipeline(rh._collected);

    const llm = TestLLMServiceLayer([
      { toolCall: { name: "web-search", args: { query: "x" } } },
      { text: "FINAL ANSWER: done" },
    ]);

    const result = await Effect.runPromise(provideTestEnvelope(
      executeReactive({
        taskDescription: "search and finish",
        taskType: "simple",
        memoryContext: "",
        availableTools: ["web-search"],
        availableToolSchemas: [TOOL_SCHEMA],
        config: defaultReasoningConfig,
        harnessPipeline: pipeline,
      }).pipe(Effect.provide(Layer.merge(llm, toolLayer()))),
    ));

    expect(result.status).toBe("completed");
    expect(observed.length).toBeGreaterThanOrEqual(1);
    expect(observed).toContain(OVERRIDE);
  });
});
