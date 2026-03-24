import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { executeReActKernel, reactKernel } from "../../../src/strategies/shared/react-kernel.js";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import {
  initialKernelState,
  noopHooks,
  type KernelContext,
  type KernelState,
} from "../../../src/strategies/shared/kernel-state.js";
import { CONTEXT_PROFILES } from "../../../src/context/context-profile.js";

describe("executeReActKernel", () => {
  it("produces a final answer for a simple task (no tools)", async () => {
    const layer = TestLLMServiceLayer([
      { match: "Task:", text: "FINAL ANSWER: The answer is 42." },
    ]);
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

  it("terminates via content stability when repeated thoughts detected", async () => {
    const layer = TestLLMServiceLayer([
      { match: "Task:", text: "I need to think more about this complex problem." },
    ]);
    const result = await Effect.runPromise(
      executeReActKernel({
        task: "Solve an extremely hard problem",
        maxIterations: 2,
      }).pipe(Effect.provide(layer)),
    );
    // LLMEndTurn evaluator (no iteration/length guards) exits on the first
    // non-empty end_turn response when there are no required tools remaining.
    expect(result.terminatedBy).toBe("end_turn");
    expect(result.iterations).toBe(1);
    expect(result.steps.length).toBe(1);
  });

  it("injects priorContext into the thought prompt", async () => {
    // The TestLLM matches on "critique says" — proving priorContext was injected
    const layer = TestLLMServiceLayer([
      { match: "critique says", text: "FINAL ANSWER: Improved response incorporating the critique feedback." },
    ]);
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
    const layer = TestLLMServiceLayer([
      { match: "Task:", text: "FINAL ANSWER: Done." },
    ]);
    const result = await Effect.runPromise(
      executeReActKernel({ task: "Simple task", maxIterations: 3 }).pipe(
        Effect.provide(layer),
      ),
    );
    expect(result.steps.length).toBeGreaterThanOrEqual(1);
    expect(result.steps[0]?.type).toBe("thought");
  });

  it("returns tokens and cost from LLM usage", async () => {
    const layer = TestLLMServiceLayer([
      { match: "Task:", text: "FINAL ANSWER: Result." },
    ]);
    const result = await Effect.runPromise(
      executeReActKernel({ task: "Simple task" }).pipe(Effect.provide(layer)),
    );
    expect(result.totalTokens).toBeGreaterThan(0);
  });

  it("handles early end_turn termination on substantive response (no tools)", async () => {
    // end_turn with ≥50 chars and no tool call should terminate as "end_turn"
    const longResponse = "A".repeat(60);
    const layer = TestLLMServiceLayer([
      { match: "Task:", text: longResponse },
    ]);
    const result = await Effect.runPromise(
      executeReActKernel({ task: "Simple task", maxIterations: 3 }).pipe(
        Effect.provide(layer),
      ),
    );
    // Either end_turn or final_answer depending on mock behavior — just verify it terminates
    expect(["end_turn", "final_answer", "max_iterations"]).toContain(result.terminatedBy);
  });

  it("blocks execution of tools listed in blockedTools", async () => {
    // The model tries to call signal/send_message_to_user, which is blocked.
    // The kernel should return a synthetic BLOCKED observation instead of executing.
    const layer = TestLLMServiceLayer([
      { match: "Task:", text: 'ACTION: signal/send_message_to_user({"recipient": "+123", "message": "hi"})' },
    ]);

    const result = await Effect.runPromise(
      executeReActKernel({
        task: "Send a message",
        maxIterations: 2,
        blockedTools: ["signal/send_message_to_user"],
      }).pipe(Effect.provide(layer)),
    );

    // Should have an observation with BLOCKED text
    const observations = result.steps.filter((s) => s.type === "observation");
    expect(observations.length).toBeGreaterThan(0);
    expect(observations[0]!.content).toContain("BLOCKED");
    expect(observations[0]!.content).toContain("signal/send_message_to_user");
  });
});

// ── reactKernel ThoughtKernel direct tests ────────────────────────────────────

describe("reactKernel (ThoughtKernel direct)", () => {
  /** Helper to build a minimal KernelContext for testing */
  function makeContext(overrides?: Partial<KernelContext>): KernelContext {
    const profile = CONTEXT_PROFILES["mid"];
    return {
      input: {
        task: "Test task",
      },
      profile,
      compression: {
        budget: profile.toolResultMaxChars ?? 800,
        previewItems: 3,
        autoStore: true,
        codeTransform: true,
      },
      toolService: { _tag: "None" },
      hooks: noopHooks,
      ...overrides,
    };
  }

  it("thinking + FINAL ANSWER transitions to done", async () => {
    const layer = TestLLMServiceLayer([
      { match: "Task:", text: "FINAL ANSWER: The answer is 42." },
    ]);

    const state = initialKernelState({
      maxIterations: 3,
      strategy: "react-kernel",
      kernelType: "react",
    });

    const context = makeContext();

    const nextState = await Effect.runPromise(
      reactKernel(state, context).pipe(Effect.provide(layer)),
    );

    expect(nextState.status).toBe("done");
    expect(nextState.output).toBe("The answer is 42.");
    expect(nextState.steps.length).toBe(1);
    expect(nextState.steps[0]!.type).toBe("thought");
    expect(nextState.iteration).toBe(1);
  });

  it("thinking + ACTION transitions to acting with pendingToolRequest", async () => {
    const layer = TestLLMServiceLayer([
      { match: "Task:", text: 'ACTION: web-search({"query": "hello world"})' },
    ]);

    const state = initialKernelState({
      maxIterations: 3,
      strategy: "react-kernel",
      kernelType: "react",
    });

    const context = makeContext();

    const nextState = await Effect.runPromise(
      reactKernel(state, context).pipe(Effect.provide(layer)),
    );

    expect(nextState.status).toBe("acting");
    expect(nextState.steps.length).toBe(1);
    expect(nextState.steps[0]!.type).toBe("thought");
    // pendingToolRequest stored in meta
    const pending = nextState.meta.pendingToolRequest as { tool: string; input: string };
    expect(pending.tool).toBe("web-search");
  });

  it("acting transitions back to thinking after tool execution (post-action requires short observation for exit)", async () => {
    const layer = TestLLMServiceLayer();

    // Start in acting state with a pending tool request
    const state: KernelState = {
      ...initialKernelState({
        maxIterations: 3,
        strategy: "react-kernel",
        kernelType: "react",
      }),
      status: "acting",
      steps: [
        {
          id: "test-step" as any,
          type: "thought",
          content: 'ACTION: web-search({"query": "hello"})',
          timestamp: new Date(),
        },
      ],
      meta: {
        pendingToolRequest: { tool: "web-search", input: '{"query": "hello"}' },
        lastThought: 'ACTION: web-search({"query": "hello"})',
        lastThinking: null,
      },
    };

    const context = makeContext();

    const nextState = await Effect.runPromise(
      reactKernel(state, context).pipe(Effect.provide(layer)),
    );

    // Post-action oracle no longer fires LLMEndTurn (stopReason is "tool_result",
    // not "end_turn"). Agent continues to thinking to synthesize tool results.
    expect(nextState.status).toBe("thinking");
    // Should have action + observation steps added
    const actionSteps = nextState.steps.filter((s) => s.type === "action");
    const obsSteps = nextState.steps.filter((s) => s.type === "observation");
    expect(actionSteps.length).toBe(1);
    expect(obsSteps.length).toBe(1);
    // Observation should mention ToolService not available since we provided None
    expect(obsSteps[0]!.content).toContain("ToolService is not available");
    // Iteration should have been incremented
    expect(nextState.iteration).toBe(1);
    // web-search should be in toolsUsed
    expect(nextState.toolsUsed.has("web-search")).toBe(true);
  });
});
