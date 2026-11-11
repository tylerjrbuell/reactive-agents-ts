// Run: bun test packages/reasoning/tests/strategies/thinking-not-deliverable.test.ts --timeout 20000
//
// Run 01M75SJ5SXXHSA63BKXM2R2P77 (mimo-v2.6 on Ollama, plan-execute-reflect):
// the planner returned one analysis step, the generation call came back with
// EMPTY content and 398 chars of provider-separated thinking ("Let me list
// the workspace..."), and the run shipped that thinking as a succeeded answer.
// Cause: deliverable call sites extracted text with `extractThinkingSafeContent`,
// whose fallback chain returns the thinking when content is empty.
//
// Pins:
//   (a) `extractDeliverableContent` strips think tags and never returns thinking;
//   (b) plan-execute's single-analysis path: thinking-only generation is not a
//       completed answer and the thinking text is not the output;
//   (c) the same run's Cortex view read "structured-output-native" as its
//       strategy: the planner's structured-output sub-call published that
//       label on ReasoningStepCompleted. Every step event now names the
//       strategy that ran.
//
// RED-ON-CUT (shown during the mission, then restored): route single-analysis.ts
// back to `extractThinkingSafeContent` → (b) fails (output === the thinking);
// drop `strategy:` from the planner call in plan-execute.ts → (c) fails.
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { EventBus, EventBusLive } from "@reactive-agents/core";
import { LLMService, TestLLMService } from "@reactive-agents/llm-provider";
import { executePlanExecute } from "../../src/strategies/plan-execute.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { provideTestEnvelope } from "../../src/kernel/envelope/run-envelope.js";
import { extractDeliverableContent } from "../../src/kernel/utils/stream-parser.js";

const THINKING =
  "The user wants me to read notes.txt in the workspace and reply with the launch code only. Let me check the workspace.";

describe("model thinking never becomes the deliverable", () => {
  it("(a) extractDeliverableContent: content only, think tags stripped, no thinking fallback", () => {
    expect(extractDeliverableContent({ content: "", thinking: THINKING })).toBe("");
    expect(extractDeliverableContent({ content: `<think>${THINKING}</think>` })).toBe("");
    expect(extractDeliverableContent({ content: `<think>${THINKING}` })).toBe("");
    expect(extractDeliverableContent({ content: "<think>scratch</think>\nThe code is 7741.", thinking: THINKING })).toBe(
      "The code is 7741.",
    );
  });

  it("(b) plan-execute single-analysis: thinking-only generation is not a completed answer", async () => {
    const inner = TestLLMService([
      {
        match: "planning agent",
        text: JSON.stringify({
          steps: [{ title: "Read launch notes", instruction: "Read notes.txt to obtain the launch code.", type: "analysis" }],
        }),
      },
      { text: "unused" },
    ]);
    // Ollama `think: true` shape: the answer channel is empty, the reasoning
    // arrives in the provider-separated `thinking` field.
    const thinkingOnly: typeof LLMService.Service = {
      ...inner,
      complete: ((req: Parameters<typeof inner.complete>[0]) =>
        inner.complete(req).pipe(
          Effect.map((r) => ({ ...r, content: "", thinking: THINKING })),
        )) as typeof inner.complete,
    };
    const result = await Effect.runPromise(
      provideTestEnvelope(
        executePlanExecute({
          taskDescription: "Read notes.txt in the workspace and reply with the launch code only.",
          taskType: "simple",
          memoryContext: "",
          availableTools: [] as string[],
          config: defaultReasoningConfig,
        }).pipe(Effect.provide(Layer.succeed(LLMService, LLMService.of(thinkingOnly)))),
      ),
    );
    const output = typeof result.output === "string" ? result.output : "";
    expect(output).not.toContain("Let me check the workspace");
    expect(result.status).not.toBe("completed");
  }, 20000);

  it("(c) the planner's structured-output sub-call publishes the run's strategy, not its own", async () => {
    const llm = TestLLMService([
      {
        match: "planning agent",
        text: JSON.stringify({
          steps: [{ title: "Answer", instruction: "Give the launch code.", type: "analysis" }],
        }),
      },
      { text: "7741" },
    ]);
    const strategies = new Set<string>();
    await Effect.runPromise(
      provideTestEnvelope(
        Effect.gen(function* () {
          const eb = yield* EventBus;
          yield* eb.on("ReasoningStepCompleted", (event) =>
            Effect.sync(() => {
              strategies.add(event.strategy);
            }),
          );
          return yield* executePlanExecute({
            taskDescription: "Reply with the launch code only.",
            taskType: "simple",
            memoryContext: "",
            availableTools: [] as string[],
            config: defaultReasoningConfig,
          });
        }).pipe(Effect.provide(Layer.mergeAll(Layer.succeed(LLMService, llm), EventBusLive))),
      ),
    );
    expect([...strategies]).toEqual(["plan-execute-reflect"]);
  }, 20000);
});
