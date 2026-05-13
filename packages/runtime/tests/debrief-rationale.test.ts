import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import {
  synthesizeDebrief,
  type DebriefInput,
} from "../src/debrief.js";
import { LLMService } from "@reactive-agents/llm-provider";
import type { Rationale } from "@reactive-agents/core";

const baseInput: DebriefInput = {
  taskPrompt: "Fetch commits and send Signal message",
  agentId: "test-agent",
  taskId: "task-123",
  terminatedBy: "final_answer_tool",
  finalAnswerCapture: {
    output: "Message sent successfully",
    format: "text",
    summary: "Fetched 5 commits and sent Signal message",
    confidence: "high",
  },
  toolCallHistory: [
    { name: "github/list_commits", calls: 1, errors: 0, avgDurationMs: 200 },
    { name: "signal/send_message_to_user", calls: 1, errors: 0, avgDurationMs: 100 },
  ],
  errorsFromLoop: [],
  metrics: { tokens: 5000, duration: 12000, iterations: 5, cost: 0 },
};

describe("synthesizeDebrief with rationale", () => {
  it("passes rationale to LLM debrief synthesis prompt", async () => {
    let capturedUserPrompt = "";

    // Create a mock LLM that captures the prompt
    const mockLLM: LLMService = {
      complete: (input) => {
        capturedUserPrompt = input.messages[0]?.content ?? "";
        return Effect.succeed({
          content: JSON.stringify({
            summary: "Agent made informed decisions.",
            keyFindings: [],
            errorsEncountered: [],
            lessonsLearned: [],
            caveats: "",
          }),
          stopReason: "end_turn" as const,
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCost: 0 },
          model: "test",
        });
      },
    };

    const rationale: Rationale = {
      why: "chose github/list_commits because task explicitly asks for commits",
      refs: ["obs:1", "scratch:goal"],
      confidence: 0.95,
    };

    const inputWithRationale: DebriefInput = {
      ...baseInput,
      // This field should exist after the fix
      rationale: [
        {
          iteration: 1,
          decision: "tool-selection",
          toolName: "github/list_commits",
          rationale,
        },
      ],
    };

    const debrief = await Effect.runPromise(
      synthesizeDebrief(inputWithRationale).pipe(Effect.provideService(LLMService, mockLLM))
    );

    // After fix, the captured prompt should include rationale information
    expect(capturedUserPrompt).toContain("rationale");
    expect(capturedUserPrompt).toContain("why");
    expect(debrief.outcome).toBe("success");
  });
});
