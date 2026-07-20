/**
 * kernel-path-tool-results.test.ts — Wave 2 B4 / #44 (2026-07-20).
 *
 * The kernel path emits each tool call as an `action` step FOLLOWED BY the
 * tool result as an `observation` step. Two invariants keep memory extraction
 * fed with the KERNEL PATH's real tool results:
 *
 *   1. `runReasoningPostThink` synthesizes `ctx.toolResults` whose `result`
 *      carries the OBSERVATION content (the tool output) — NOT the `action`
 *      step's `toolName(args)` call text. Red-on-cut: revert to `s.content`
 *      and memory extraction sees call signatures, not tool results (#44).
 *
 *   2. `memoryFlush` reaches extraction from `ctx.toolResults` (multi-tool
 *      gate) and feeds each `tr.result` to the extractor. Red-on-cut: an empty
 *      `ctx.toolResults` (the pre-bridge kernel-path state) never reaches
 *      extraction.
 */
import { describe, it, expect } from "bun:test";
import { Context, Effect, Layer } from "effect";
import { runReasoningPostThink } from "../src/engine/phases/agent-loop/reasoning-post-think.js";
import { memoryFlush } from "../src/engine/phases/memory-flush.js";
import type { ExecutionContext } from "../src/types.js";
import type { PhaseDeps } from "../src/engine/runtime-context.js";

const OBSERVATION = "RESULT: found 3 matching files in src/kernel";
const CALL_TEXT = "grep(pattern=kernel)";

function makeCtx(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    taskId: "t-1",
    agentId: "agent-test",
    sessionId: "s-1",
    phase: "think",
    agentState: "running",
    iteration: 2,
    maxIterations: 10,
    messages: [],
    toolResults: [],
    cost: 0,
    tokensUsed: 0,
    startedAt: new Date(),
    metadata: {},
    ...overrides,
  } as unknown as ExecutionContext;
}

describe("#44: reasoning-post-think bridges the kernel path's tool RESULTS", () => {
  it("synthetic toolResults carry the observation content, not the action call text", async () => {
    const ctx = makeCtx({
      metadata: {
        reasoningSteps: [
          { id: "a1", type: "action", content: CALL_TEXT, metadata: { toolUsed: "grep" } },
          {
            id: "o1",
            type: "observation",
            content: OBSERVATION,
            metadata: { observationResult: { success: true } },
          },
        ],
        stepsCount: 2,
      },
    });

    const result = await Effect.runPromise(
      runReasoningPostThink(ctx, {
        config: {} as never,
        task: { id: "t-1", agentId: "agent-test", input: "find kernel files", type: "qa", metadata: {} } as never,
        obs: null,
        isNormal: false,
        fireActObserveHooks: (c) => Effect.succeed(c),
      }) as Effect.Effect<ExecutionContext, never, never>,
    );

    expect(result.toolResults.length).toBe(1);
    const tr = result.toolResults[0] as { toolName: string; result: string };
    expect(tr.toolName).toBe("grep");
    // The kernel path's real tool RESULT — not the call signature.
    expect(tr.result).toBe(OBSERVATION);
    expect(tr.result).not.toBe(CALL_TEXT);
  });
});

// Recreate the private tag by its string identity so the layer resolves.
type MemoryExtractorLike = {
  extractFromConversation: (
    agentId: string,
    messages: readonly { role: string; content: string }[],
  ) => Effect.Effect<unknown[], unknown>;
};
const MemoryExtractorTag = Context.GenericTag<MemoryExtractorLike>("MemoryExtractor");

function makeDeps(overrides: Partial<PhaseDeps> = {}): PhaseDeps {
  return {
    task: { id: "t-1", agentId: "agent-test", input: "find kernel files", type: "qa", metadata: {} },
    config: { agentId: "agent-test" } as never,
    hooks: { register: () => Effect.succeed(() => {}), run: (_p: unknown, _t: unknown, c: unknown) => Effect.succeed(c), list: () => Effect.succeed([]) } as never,
    obs: null,
    eb: null,
    ks: null,
    guardrail: null,
    behavioral: null,
    tools: null,
    state: { cancelledTasks: null as never, runningContexts: null as never },
    isNormal: false,
    executionStartMs: Date.now(),
    ...overrides,
  } as PhaseDeps;
}

describe("#44: memory-flush extraction sees the kernel path's tool results", () => {
  it("feeds each synthetic tool RESULT to the extractor (multi-tool gate reachable)", async () => {
    const captured: { role: string; content: string }[][] = [];
    const extractorLayer = Layer.succeed(MemoryExtractorTag, {
      extractFromConversation: (_agentId, messages) => {
        captured.push([...messages]);
        return Effect.succeed([]);
      },
    });

    const ctx = makeCtx({
      metadata: { lastResponse: "short" },
      toolResults: [
        { toolName: "grep", result: OBSERVATION, success: true },
        { toolName: "read", result: "file body: export const x = 1", success: true },
      ],
    });

    await Effect.runPromise(
      (memoryFlush.run(ctx, makeDeps()) as Effect.Effect<ExecutionContext, never, never>).pipe(
        Effect.provide(extractorLayer),
      ) as Effect.Effect<ExecutionContext, never, never>,
    );

    // Extraction fired (multi-tool gate) despite a short response.
    expect(captured.length).toBe(1);
    const joined = captured[0].map((m) => m.content).join("\n");
    // The extractor saw the ACTUAL tool result content from the kernel path.
    expect(joined).toContain(OBSERVATION);
  });
});
