import { describe, it, expect } from "bun:test";
import { Effect, Layer, Context, Stream } from "effect";
import {
  ExecutionEngine,
  ExecutionEngineLive,
  LifecycleHookRegistryLive,
} from "../src/index.js";
import { defaultReactiveAgentsConfig } from "../src/types.js";
import { withHistoryBlock } from "../src/reactive-agent.js";
import type { ChatMessage } from "../src/chat.js";

// ── Tool-capable chat presents prior turns as a labeled reference block ──
//
// History is folded into the task TEXT (gateway-style, gateway-context-formatting.ts)
// rather than seeded into the kernel's native-FC `state.messages`. Seeding plain
// prior "assistant" final-answers into the FC tool thread made the model treat
// them as its own tool-orchestration turns → it re-ran tools and conflated data
// on a follow-up ("based on your findings, should I…"). A labeled text block keeps
// the FC thread clean while staying history-aware.

const hist = (turns: Array<["user" | "assistant", string]>): ChatMessage[] =>
  turns.map(([role, content]) => ({ role, content, timestamp: 0 }));

describe("withHistoryBlock — gateway-style history presentation", () => {
  it("returns the input unchanged when there is no history", () => {
    expect(withHistoryBlock("What is my name?")).toBe("What is my name?");
    expect(withHistoryBlock("hi", [])).toBe("hi");
  });

  it("prepends a labeled conversation block and a current-message marker", () => {
    const out = withHistoryBlock(
      "Should I hold or sell?",
      hist([
        ["user", "Research XRP."],
        ["assistant", "XRP is $1.14, trend down."],
      ]),
    );
    expect(out).toContain("--- Conversation history ---");
    expect(out).toContain("User: Research XRP.");
    expect(out).toContain("Assistant: XRP is $1.14, trend down.");
    expect(out).toContain("--- Current message ---");
    // The actual ask comes after the history, clearly delineated.
    expect(out.indexOf("--- Conversation history ---")).toBeLessThan(
      out.indexOf("--- Current message ---"),
    );
    expect(out.trimEnd().endsWith("Should I hold or sell?")).toBe(true);
  });
});

const ReasoningServiceTag = Context.GenericTag<{
  execute: (params: {
    initialMessages?: readonly { readonly role: "user" | "assistant"; readonly content: string }[];
    [k: string]: unknown;
  }) => Effect.Effect<{
    output: unknown;
    status: string;
    steps?: readonly { id: string; type: string; content: string }[];
    metadata: { cost: number; tokensUsed: number; stepsCount: number };
  }>;
}>("ReasoningService");

describe("kernel FC thread is not pre-seeded with prior turns", () => {
  it("seeds initialMessages with exactly one user message (the task text)", async () => {
    const captured: Array<{
      initialMessages?: readonly { readonly role: string; readonly content: string }[];
    }> = [];
    const stubReasoning = {
      execute: (params: any) => {
        captured.push(params);
        return Effect.succeed({
          output: "ok",
          status: "completed",
          steps: [],
          metadata: { cost: 0, tokensUsed: 5, stepsCount: 0 },
        });
      },
    };
    const config = defaultReactiveAgentsConfig("agent-fc", {});
    const hookLayer = LifecycleHookRegistryLive;
    const engineLayer = ExecutionEngineLive(config).pipe(Layer.provide(hookLayer));
    const testLayer = Layer.mergeAll(
      hookLayer,
      engineLayer,
      Layer.succeed(ReasoningServiceTag, stubReasoning),
    );

    // The task text already carries the folded history block (as run() produces).
    const taskText = withHistoryBlock("Should I hold or sell?", hist([["user", "Research XRP."]]));

    await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;
        const stream = yield* engine.executeStream({
          id: "task-fc-001" as any,
          agentId: "agent-fc" as any,
          type: "query" as const,
          input: { question: taskText },
          priority: "medium" as const,
          status: "pending" as const,
          metadata: { tags: [] },
          createdAt: new Date(),
        });
        yield* Stream.runDrain(stream);
      }).pipe(Effect.provide(testLayer)),
    );

    const seeded = captured[0]!.initialMessages ?? [];
    // Exactly one user message — no separate "assistant" turns injected into the
    // FC thread. The history lives inside that single message's text.
    expect(seeded.length).toBe(1);
    expect(seeded[0]!.role).toBe("user");
    expect(seeded[0]!.content).toContain("--- Conversation history ---");
  });
});
