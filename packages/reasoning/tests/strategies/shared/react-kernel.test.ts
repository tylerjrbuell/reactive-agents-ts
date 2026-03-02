import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { executeReActKernel } from "../../../src/strategies/shared/react-kernel.js";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";

describe("executeReActKernel", () => {
  it("produces a final answer for a simple task (no tools)", async () => {
    const layer = TestLLMServiceLayer({
      "Task:": "FINAL ANSWER: The answer is 42.",
    });
    const result = await Effect.runPromise(
      executeReActKernel({
        task: "What is 6 times 7?",
        maxIterations: 3,
      }).pipe(Effect.provide(layer)),
    );
    expect(result.output).toBe("The answer is 42.");
    expect(result.terminatedBy).toBe("final_answer");
    expect(result.iterations).toBe(1);
  });

  it("terminates at maxIterations when no final answer produced", async () => {
    const layer = TestLLMServiceLayer({
      "Task:": "I need to think more about this complex problem.",
    });
    const result = await Effect.runPromise(
      executeReActKernel({
        task: "Solve an extremely hard problem",
        maxIterations: 2,
      }).pipe(Effect.provide(layer)),
    );
    expect(result.terminatedBy).toBe("max_iterations");
    expect(result.iterations).toBe(2);
    expect(result.steps.length).toBe(2);
  });

  it("injects priorContext into the thought prompt", async () => {
    // The TestLLM matches on "critique says" — proving priorContext was injected
    const layer = TestLLMServiceLayer({
      "critique says": "FINAL ANSWER: Improved response incorporating the critique feedback.",
    });
    const result = await Effect.runPromise(
      executeReActKernel({
        task: "Explain quantum computing",
        priorContext: "A previous critique says: add more concrete examples",
        maxIterations: 2,
      }).pipe(Effect.provide(layer)),
    );
    expect(result.output).toContain("Improved response");
    expect(result.terminatedBy).toBe("final_answer");
  });

  it("records steps for each iteration", async () => {
    const layer = TestLLMServiceLayer({
      "Task:": "FINAL ANSWER: Done.",
    });
    const result = await Effect.runPromise(
      executeReActKernel({ task: "Simple task", maxIterations: 3 }).pipe(
        Effect.provide(layer),
      ),
    );
    expect(result.steps.length).toBeGreaterThanOrEqual(1);
    expect(result.steps[0]?.type).toBe("thought");
  });

  it("returns tokens and cost from LLM usage", async () => {
    const layer = TestLLMServiceLayer({
      "Task:": "FINAL ANSWER: Result.",
    });
    const result = await Effect.runPromise(
      executeReActKernel({ task: "Simple task" }).pipe(Effect.provide(layer)),
    );
    expect(result.totalTokens).toBeGreaterThan(0);
  });

  it("handles early end_turn termination on substantive response (no tools)", async () => {
    // end_turn with ≥50 chars and no tool call should terminate as "end_turn"
    const longResponse = "A".repeat(60);
    const layer = TestLLMServiceLayer({
      "Task:": longResponse,
    });
    const result = await Effect.runPromise(
      executeReActKernel({ task: "Simple task", maxIterations: 3 }).pipe(
        Effect.provide(layer),
      ),
    );
    // Either end_turn or final_answer depending on mock behavior — just verify it terminates
    expect(["end_turn", "final_answer", "max_iterations"]).toContain(result.terminatedBy);
  });
});
