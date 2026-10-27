/**
 * Continuation passes (withMinIterations / customTermination / validator /
 * reflect-REVISE) must SEE the answer they are continuing. The kernel projects
 * only the first user message, so a `[task, assistant, "Continue"]` thread used
 * to reach the model as the bare task — a blind restart that redid every tool
 * call. Pin: the continuation's goal carries the previous answer.
 */
import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { ReactiveAgents } from "../src/builder.js";

describe("withMinIterations continuation", () => {
  test("second pass is shown the first pass's answer", async () => {
    const exchanges: string[] = [];
    const agent = await ReactiveAgents.create()
      .withName("min-iter-continuation")
      .withTestScenario([
        { toolCall: { name: "echo-tool", args: { input: "a" } } },
        { text: "FINAL ANSWER: first-pass-answer" },
        { text: "FINAL ANSWER: second-pass-answer" },
      ])
      .withTools({
        tools: [
          {
            definition: {
              name: "echo-tool",
              description: "echo",
              parameters: [{ name: "input", type: "string" as const, description: "i", required: true }],
              riskLevel: "low" as const,
              timeoutMs: 5_000,
              requiresApproval: false,
              source: "function" as const,
            },
            handler: (a: Record<string, unknown>) => Effect.succeed(`echoed ${String(a.input)}`),
          },
        ],
      })
      .withReasoning({ defaultStrategy: "reactive" })
      .withRequiredTools({ adaptive: false })
      .withMinIterations(2)
      .withMaxIterations(6)
      .build();
    try {
      await agent.subscribe("LLMExchangeEmitted" as never, ((e: { messages?: unknown }) => {
        exchanges.push(JSON.stringify(e.messages));
      }) as never);
      await agent.run("say hi using echo-tool");
      expect(exchanges.some((m) => m.includes("first-pass-answer") && m.includes("previous answer"))).toBe(true);
    } finally {
      await agent.dispose();
    }
  }, 60000);
});
