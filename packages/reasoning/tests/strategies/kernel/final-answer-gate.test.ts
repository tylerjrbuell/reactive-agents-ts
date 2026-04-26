import { describe, expect, it } from "bun:test";
import { Effect, Layer, Stream } from "effect";
import { LLMService, DEFAULT_CAPABILITIES } from "@reactive-agents/llm-provider";
import type { CompletionResponse, StreamEvent } from "@reactive-agents/llm-provider";
import { executeReActKernel } from "../../../src/kernel/loop/react-kernel.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Create a sequential LLM mock that returns each response in order.
 * Uses the stream() method (which the kernel calls) with stateful call counter.
 */
function makeSequentialLLMLayer(responses: string[]): ReturnType<typeof Layer.succeed<typeof LLMService>> {
  let callCount = 0;

  const service: typeof LLMService.Service = {
    complete: (_request) =>
      Effect.succeed({
        content: "FINAL ANSWER: fallback",
        stopReason: "end_turn" as const,
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCost: 0 },
        model: "test",
      } satisfies CompletionResponse),

    stream: (_request) => {
      const idx = callCount;
      callCount++;
      const text = responses[idx] ?? "FINAL ANSWER: done";
      return Effect.succeed(
        Stream.make(
          {
            type: "content_complete" as const,
            content: text,
          } satisfies StreamEvent,
          {
            type: "usage" as const,
            usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20, estimatedCost: 0 },
          } satisfies StreamEvent,
        ),
      );
    },

    completeStructured: (_request) => Effect.succeed({} as any),

    embed: (_request) =>
      Effect.succeed(
        [[0.1, 0.2, 0.3]] as readonly (readonly number[])[],
      ),

    countTokens: (_messages) => Effect.succeed(100),

    getModelConfig: () =>
      Effect.succeed({ provider: "anthropic" as const, model: "test-model" }),

    getStructuredOutputCapabilities: () =>
      Effect.succeed({
        nativeJsonMode: true,
        jsonSchemaEnforcement: false,
        prefillSupport: false,
        grammarConstraints: false,
      }),

    capabilities: () =>
      Effect.succeed({
        ...DEFAULT_CAPABILITIES,
        supportsToolCalling: true,
        supportsStreaming: true,
      }),
  };

  return Layer.succeed(LLMService, LLMService.of(service));
}

/**
 * Create a sequential LLM mock that returns native tool calls in order.
 * Used for testing the native FC path (final-answer tool, etc.)
 */
function makeSequentialToolCallLLMLayer(
  toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>,
): ReturnType<typeof Layer.succeed<typeof LLMService>> {
  let callCount = 0;

  const service: typeof LLMService.Service = {
    complete: (_request) =>
      Effect.succeed({
        content: "FINAL ANSWER: fallback",
        stopReason: "end_turn" as const,
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCost: 0 },
        model: "test",
      } satisfies CompletionResponse),

    stream: (_request) => {
      const idx = callCount;
      callCount++;
      const tc = toolCalls[idx];
      if (tc) {
        const events: StreamEvent[] = [
          { type: "tool_use_start" as const, id: `call-${idx}`, name: tc.name },
          { type: "tool_use_delta" as const, input: JSON.stringify(tc.arguments) },
          { type: "content_complete" as const, content: "" },
          { type: "usage" as const, usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20, estimatedCost: 0 } },
        ];
        return Effect.succeed(Stream.fromIterable(events) as import("effect").Stream.Stream<StreamEvent, never>);
      }
      // Fallback: final answer text
      return Effect.succeed(
        Stream.make(
          { type: "content_complete" as const, content: "FINAL ANSWER: done" } satisfies StreamEvent,
          { type: "usage" as const, usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20, estimatedCost: 0 } } satisfies StreamEvent,
        ),
      );
    },

    completeStructured: (_request) => Effect.succeed({} as any),

    embed: (_request) =>
      Effect.succeed(
        [[0.1, 0.2, 0.3]] as readonly (readonly number[])[],
      ),

    countTokens: (_messages) => Effect.succeed(100),

    getModelConfig: () =>
      Effect.succeed({ provider: "anthropic" as const, model: "test-model" }),

    getStructuredOutputCapabilities: () =>
      Effect.succeed({
        nativeJsonMode: true,
        jsonSchemaEnforcement: false,
        prefillSupport: false,
        grammarConstraints: false,
      }),

    capabilities: () =>
      Effect.succeed({
        ...DEFAULT_CAPABILITIES,
        supportsToolCalling: true,
        supportsStreaming: true,
      }),
  };

  return Layer.succeed(LLMService, LLMService.of(service));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("final-answer hard gate", () => {
  it("terminates loop immediately when final-answer tool is called with accepted:true", async () => {
    // Model directly calls final-answer on the first iteration.
    // With no requiredTools, canComplete = true (requiredTools.length === 0).
    const llmLayer = makeSequentialToolCallLLMLayer([
      { name: "final-answer", arguments: { output: "Task complete. Wrote hello to out.txt.", format: "text", summary: "Wrote a file", confidence: "high" } },
    ]);

    const result = await Effect.runPromise(
      executeReActKernel({
        task: "Write hello to a file",
        systemPrompt: "You are a helpful assistant.",
        availableToolSchemas: [],
        maxIterations: 10,
      }).pipe(Effect.provide(llmLayer)),
    );

    expect(result.terminatedBy).toBe("final_answer_tool");
    expect(result.output).toBe("Task complete. Wrote hello to out.txt.");
    expect(result.finalAnswerCapture).toBeDefined();
    expect(result.finalAnswerCapture?.output).toBe("Task complete. Wrote hello to out.txt.");
    expect(result.finalAnswerCapture?.format).toBe("text");
    expect(result.finalAnswerCapture?.summary).toBe("Wrote a file");
  });

  it("stores finalAnswerCapture in meta when final-answer tool exits the loop", async () => {
    const llmLayer = makeSequentialToolCallLLMLayer([
      { name: "final-answer", arguments: { output: "Results saved.", format: "text", summary: "Saved data to file", confidence: "high" } },
    ]);

    const result = await Effect.runPromise(
      executeReActKernel({
        task: "Save data to a file",
        maxIterations: 10,
      }).pipe(Effect.provide(llmLayer)),
    );

    expect(result.terminatedBy).toBe("final_answer_tool");
    expect(result.output).toBe("Results saved.");
  });

  it("does not exit when FINAL ANSWER: text is used — falls back to final_answer terminatedBy", async () => {
    // When conditions aren't met for the tool path, the classic text fallback still works
    const llmLayer = makeSequentialLLMLayer([
      "FINAL ANSWER: done without tool",
    ]);

    const result = await Effect.runPromise(
      executeReActKernel({
        task: "Simple task",
        systemPrompt: "",
        availableToolSchemas: [],
        maxIterations: 3,
      }).pipe(Effect.provide(llmLayer)),
    );

    // Should still complete — via the text fallback "FINAL ANSWER:"
    expect(result.output).toBeTruthy();
    expect(["final_answer", "final_answer_tool", "end_turn", "max_iterations"]).toContain(result.terminatedBy);
  });

  it("final-answer tool adds final-answer to toolsUsed", async () => {
    const llmLayer = makeSequentialToolCallLLMLayer([
      { name: "final-answer", arguments: { output: "done", format: "text", summary: "completed", confidence: "high" } },
    ]);

    const result = await Effect.runPromise(
      executeReActKernel({
        task: "Test toolsUsed tracking",
        maxIterations: 10,
      }).pipe(Effect.provide(llmLayer)),
    );

    expect(result.terminatedBy).toBe("final_answer_tool");
    expect(result.toolsUsed).toContain("final-answer");
  });
});
