// Zero-token probe (harness-warden, 2026-11-18 strategy-substrate conformance audit).
// Run: bun .agents/skills/harness-improvement-loop/scripts/probe-code-action-approval-scope.ts
//
// Question: does code-action refuse an approval policy that gates ONLY tools the
// run cannot call? Cortex's default policy folds every registered
// `requiresApproval` tool (file-write, code-execute, ...) into `policy.tools`,
// so a run whose callable tools are read-only (crypto-price, web-search) still
// carries a non-empty `tools` set.
//
// Arms (TestLLMService, no network):
//   A  policy.tools = {file-write}, callable = [crypto-price]   (Cortex shape)
//   B  policy.tools = {},           callable = [crypto-price]   (control)
//   C  no policy,                   callable = [crypto-price]   (control)
import { Effect, Either } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { executeCodeAction } from "../../../../packages/reasoning/src/strategies/code-action.js";
import { defaultReasoningConfig } from "../../../../packages/reasoning/src/types/config.js";
import { provideTestEnvelope, buildRunEnvelope } from "../../../../packages/reasoning/src/kernel/envelope/run-envelope.js";

const CRYPTO = {
  name: "crypto-price",
  description: "Current price for coins",
  parameters: [{ name: "coins", type: "array", description: "symbols", required: true }],
};

type Policy = Parameters<typeof buildRunEnvelope>[0]["approvalPolicy"];

const arm = async (label: string, approvalPolicy: Policy | undefined) => {
  const program = executeCodeAction({
    taskDescription: "Find the current price of BTC and report it",
    taskType: "simple",
    memoryContext: "",
    availableTools: ["crypto-price"],
    availableToolSchemas: [CRYPTO],
    config: defaultReasoningConfig,
  }).pipe(Effect.either, Effect.provide(TestLLMServiceLayer([{ text: "```ts\nreturn 'BTC 1';\n```" }])));
  const result = await Effect.runPromise(
    provideTestEnvelope(program, buildRunEnvelope(approvalPolicy ? { approvalPolicy } : {})),
  );
  const refused = Either.isLeft(result) && String(result.left.message).includes("cannot honor");
  const detail = Either.isLeft(result) ? `left: ${String(result.left.message).slice(0, 90)}` : `right: status=${result.right.status}`;
  console.log(`${label}\trefused=${refused}\t${detail}`);
};

await arm("A gated-not-callable", { mode: "detach", tools: new Set(["file-write"]) });
await arm("B empty-policy      ", { mode: "detach", tools: new Set<string>() });
await arm("C no-policy         ", undefined);
