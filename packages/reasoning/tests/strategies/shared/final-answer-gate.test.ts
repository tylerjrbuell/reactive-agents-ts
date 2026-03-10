import { describe, expect, it } from "bun:test";
import { Effect, Layer, Stream } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";
import type { CompletionResponse, StreamEvent } from "@reactive-agents/llm-provider";
import { executeReActKernel } from "../../../src/strategies/shared/react-kernel.js";

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

    embed: (_request) =>
      Effect.succeed({ embeddings: [[0.1, 0.2, 0.3]], model: "test", usage: { inputTokens: 0 } }),
  };

  return Layer.succeed(LLMService, LLMService.of(service));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("final-answer hard gate", () => {
  it("terminates loop immediately when final-answer tool is called with accepted:true", async () => {
    // LLM call 1: model calls a regular tool (file-write) → satisfies hasNonMetaToolCalled
    // LLM call 2: model calls final-answer → should hard-exit
    // LLM call 3 (if loop continues): would be an error — proves we exited after call 2
    const llmLayer = makeSequentialLLMLayer([
      'ACTION: file-write({"path": "./out.txt", "content": "hello"})',
      'ACTION: final-answer({"output": "Task complete. Wrote hello to out.txt.", "format": "text", "summary": "Wrote a file", "confidence": "high"})',
      "FINAL ANSWER: should not reach here — loop should have exited",
    ]);

    const result = await Effect.runPromise(
      executeReActKernel({
        task: "Write hello to a file",
        systemPrompt: "You are a helpful assistant.",
        availableToolSchemas: [],
        config: { maxIterations: 10, minIterations: 0 },
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
    const llmLayer = makeSequentialLLMLayer([
      'ACTION: file-write({"path": "./result.txt", "content": "data"})',
      'ACTION: final-answer({"output": "Results saved.", "format": "text", "summary": "Saved data to file", "confidence": "high"})',
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
    const llmLayer = makeSequentialLLMLayer([
      'ACTION: file-write({"path": "./x.txt", "content": "y"})',
      'ACTION: final-answer({"output": "done", "format": "text", "summary": "completed", "confidence": "high"})',
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
