// Run: bun test packages/reasoning/tests/strategies/code-action-approval-commands.test.ts --timeout 15000
//
// code-action runs tools inside the sandbox Worker, past the approval gate, so
// it refuses any approval policy that gates something. Shell command rules
// (`approvalPolicy.commands`) gate calls too: a policy with only command rules
// must be refused like one with gated tools, or a rule-matched `git push`
// would run with no human decision.
import { describe, it, expect } from "bun:test";
import { Effect, Either } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { executeCodeAction } from "../../src/strategies/code-action.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { provideTestEnvelope, buildRunEnvelope } from "../../src/kernel/envelope/run-envelope.js";

describe("code-action — approval command rules", () => {
  it("refuses a policy that gates only shell commands", async () => {
    const result = await Effect.runPromise(
      provideTestEnvelope(
        executeCodeAction({
          taskDescription: "push the branch",
          taskType: "simple",
          memoryContext: "",
          availableTools: [],
          config: defaultReasoningConfig,
        }).pipe(Effect.either, Effect.provide(TestLLMServiceLayer())),
        buildRunEnvelope({
          approvalPolicy: { mode: "block", tools: new Set<string>(), commands: ["git push"] },
        }),
      ),
    );
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) expect(result.left.message).toContain("cannot honor");
  });
});
