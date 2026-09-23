// Run: bun test packages/runtime/tests/builder-judgment-context.test.ts --timeout 15000
//
// Phase D Task 1 - `includeContext` end-to-end through a live ReactiveAgent's
// agent.judge(). Complements judgment-context.test.ts (pure unit tests) by
// pinning that:
//   (a) includeContext: false/omitted -> byte-identical to pre-Phase-D
//       judge() (same assertion builder-judgment.test.ts already covers,
//       re-run here unmodified as the Exit check requires).
//   (b) includeContext: true with no manual state -> the auto-merged state
//       (recent tool observations from the last run()) reaches the backend.
//   (c) manual state key collides with an auto-context key -> manual wins.

import { describe, it, expect, afterEach } from "bun:test";
import { Effect, Layer } from "effect";
import {
  LLMService,
  TestLLMService,
  type TestTurn,
  type StructuredCompletionRequest,
} from "@reactive-agents/llm-provider";
import { ReactiveAgents } from "../src/index.js";

const noulQuestion = {
  onTrack: {
    type: "noul" as const,
    instructions: "Is this on track?",
  },
};

/**
 * Wraps a real `TestLLMService` (so `complete`/`stream` still drive the
 * scripted agent scenario normally) but replaces `completeStructured()` with
 * one that records the exact prompt text it was called with and answers a
 * canned "onTrack" noul question — enough for the `llm` judgment backend's
 * batched schema (see packages/judgment/src/backends/llm-backend.ts's
 * buildPrompt(), which JSON.stringifies `state` into that prompt) without a
 * live provider.
 */
const makeCapturingLLM = (
  scenario: TestTurn[],
  capturedPrompts: string[],
): Layer.Layer<LLMService> => {
  const real = TestLLMService(scenario);
  return Layer.succeed(LLMService, {
    ...real,
    completeStructured: <A>(request: StructuredCompletionRequest<A>) => {
      const firstContent = request.messages[0]?.content;
      capturedPrompts.push(typeof firstContent === "string" ? firstContent : JSON.stringify(firstContent ?? ""));
      const answer: { onTrack: { probability: number } } = { onTrack: { probability: 0.5 } };
      return Effect.succeed(answer as A);
    },
  });
};

describe("agent.judge({ includeContext }) - Phase D Task 1", () => {
  const agentsToDispose: Array<{ dispose: () => Promise<void> }> = [];
  afterEach(async () => {
    while (agentsToDispose.length > 0) {
      await agentsToDispose.pop()!.dispose();
    }
  });

  it("includeContext omitted: judge() reaches the backend with exactly the manual state (no auto-context)", async () => {
    const capturedPrompts: string[] = [];
    const scenario: TestTurn[] = [{ text: "FINAL ANSWER: done" }];
    const agent = await ReactiveAgents.create()
      .withName("judgment-context-omitted-agent")
      .withProvider("test")
      .withTestScenario(scenario)
      .withReasoning({ defaultStrategy: "reactive" })
      .withReplayLLM(makeCapturingLLM(scenario, capturedPrompts))
      .withJudgment({ backend: "llm" })
      .build();
    agentsToDispose.push(agent);

    await agent.judge({ state: { action: "deploy" }, questions: noulQuestion });

    expect(capturedPrompts.length).toBe(1);
    expect(capturedPrompts[0]).toContain("deploy");
    expect(capturedPrompts[0]).not.toContain("recentMessages");
    expect(capturedPrompts[0]).not.toContain("toolResults");
  });

  it("includeContext: true with no manual state - merged state contains message window + tool summaries", async () => {
    const capturedPrompts: string[] = [];
    const scenario: TestTurn[] = [
      { toolCall: { name: "shell-execute", args: { command: "echo tool-observation-marker-xyz" } } },
      { text: "FINAL ANSWER: done" },
    ];
    const agent = await ReactiveAgents.create()
      .withName("judgment-context-merged-agent")
      .withProvider("test")
      .withTestScenario(scenario)
      .withReasoning({ defaultStrategy: "reactive" })
      .withTools({ terminal: true })
      .withMaxIterations(3)
      .withReplayLLM(makeCapturingLLM(scenario, capturedPrompts))
      .withJudgment({ backend: "llm" })
      .build();
    agentsToDispose.push(agent);

    await agent.run("Echo the marker and confirm.");
    await agent.judge({ questions: noulQuestion, includeContext: true });

    // `.withJudgment()` also auto-wires a strategy-selection shadow judgment
    // during run() (see apps/docs/src/content/docs/features/judgment-layer.md
    // — "Strategy selection ... shadow ... fires automatically once wired"),
    // so completeStructured may be called once for that shadow site ahead of
    // our own judge() call. Assert on the LAST captured prompt, which is
    // always the one this test's own judge() call produced.
    const lastPrompt = capturedPrompts[capturedPrompts.length - 1]!;
    expect(lastPrompt).toContain("toolResults");
    expect(lastPrompt).toContain("tool-observation-marker-xyz");
  });

  it("manual state key collides with an auto-context key - manual wins", async () => {
    const capturedPrompts: string[] = [];
    const scenario: TestTurn[] = [
      { toolCall: { name: "shell-execute", args: { command: "echo tool-observation-marker-xyz" } } },
      { text: "FINAL ANSWER: done" },
    ];
    const agent = await ReactiveAgents.create()
      .withName("judgment-context-collision-agent")
      .withProvider("test")
      .withTestScenario(scenario)
      .withReasoning({ defaultStrategy: "reactive" })
      .withTools({ terminal: true })
      .withMaxIterations(3)
      .withReplayLLM(makeCapturingLLM(scenario, capturedPrompts))
      .withJudgment({ backend: "llm" })
      .build();
    agentsToDispose.push(agent);

    await agent.run("Echo the marker and confirm.");
    await agent.judge({
      questions: noulQuestion,
      includeContext: true,
      state: { toolResults: ["explicit override, not the auto-marker"] },
    });

    // See the previous test's comment: the run() shadow-judgment site may
    // also capture a prompt, so assert on this test's own (last) call.
    const lastPrompt = capturedPrompts[capturedPrompts.length - 1]!;
    expect(lastPrompt).toContain("explicit override, not the auto-marker");
    expect(lastPrompt).not.toContain("tool-observation-marker-xyz");
  });
});
