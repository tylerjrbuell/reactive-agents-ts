// Regression: reasoning-post-think.ts bridges the reasoning-strategy path to
// episodic memory (ReasoningService.execute handles tools internally, so the
// inline-path logEpisode() never fires for it). The `content` field used to
// be built with `String(task.input)` / `String(thinkRes.output)` — fine for
// string task input/output, but `task.input` and a strategy's `output` are
// both typed `unknown` and are routinely plain objects (structured task
// input, `.withOutputSchema()` results). `String({...})` silently produces
// the literal text "[object Object]", which then feeds straight into the
// episodic_log FTS5 index — so recall/search over any structured-input or
// structured-output run returned "[object Object]" noise instead of the
// real task text.
//
// Fixed to `extractTaskText()` (string passthrough, `.question` field
// extraction, else JSON.stringify) on both sides. This test drives
// `runReasoningPostThink` directly with a stubbed `MemoryServiceLogEpisodeTag`
// that captures the logged episode, using a task.input WITHOUT a `.question`
// field (so the fix's JSON.stringify fallback is actually exercised) and a
// non-string reasoning output.
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import type { Task } from "@reactive-agents/core";
import { runReasoningPostThink } from "../src/engine/phases/agent-loop/reasoning-post-think.js";
import { MemoryService } from "@reactive-agents/memory";
import { defaultReactiveAgentsConfig } from "../src/types.js";
import type { ExecutionContext } from "../src/types.js";
import { makeExecutionContext, makeTask } from "../src/testing/index.js";

const task: Task = makeTask({
  id: "t1",
  type: "research",
  agentId: "a1",
  // No `.question` field — extractTaskText must fall back to JSON.stringify,
  // not `String()`, or this comes back as "[object Object]".
  input: { topic: "distributed consensus", depth: "deep" },
  metadata: { tags: [] },
});

const makeCtx = (): ExecutionContext =>
  makeExecutionContext({
    taskId: "t1",
    agentId: "a1",
    sessionId: "s1",
    phase: "think",
    iteration: 1,
    maxIterations: 4,
    tokensUsed: 100,
    selectedStrategy: "reactive",
    metadata: {
      reasoningResult: {
        strategy: "reactive",
        status: "completed",
        // Structured output (e.g. `.withOutputSchema()`) — also not a string.
        output: { summary: "RAFT reaches consensus via leader election.", confidence: 0.9 },
        metadata: { cost: 0, tokensUsed: 0, stepsCount: 3 },
      },
      stepsCount: 3,
    },
  });

describe("reasoning-post-think episodic content (regression)", () => {
  it("never logs literal '[object Object]' for object task input/output", async () => {
    const captured: unknown[] = [];
    const memoryLayer = Layer.succeed(MemoryService, {
      bootstrap: () => Effect.die("unused"),
      flush: () => Effect.void,
      snapshot: () => Effect.void,
      addToWorking: () => Effect.void,
      storeSemantic: (entry) => Effect.succeed(entry.id),
      logEpisode: (episode) => {
        captured.push(episode);
        return Effect.succeed(episode.id);
      },
      getWorking: () => Effect.succeed([]),
    });

    await Effect.runPromise(
      runReasoningPostThink(makeCtx(), {
        config: defaultReactiveAgentsConfig("a1"),
        task,
        obs: null,
        isNormal: false,
        fireActObserveHooks: (ctx) => Effect.succeed(ctx),
      }).pipe(Effect.provide(memoryLayer)),
    );

    expect(captured.length).toBeGreaterThanOrEqual(1);
    const content = (captured[0] as { content: string }).content;

    expect(content).not.toContain("[object Object]");
    expect(content).toContain("distributed consensus");
    expect(content).toContain("RAFT reaches consensus");
  });
});
