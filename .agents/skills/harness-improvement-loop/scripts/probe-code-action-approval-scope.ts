// Zero-token probe (harness-warden, 2026-11-18 strategy-substrate conformance audit).
// Run: bun .agents/skills/harness-improvement-loop/scripts/probe-code-action-approval-scope.ts
//
// Question: does code-action refuse an approval policy that gates ONLY tools the
// run cannot call? Cortex's default policy folds every registered
// `requiresApproval` tool (file-write, code-execute, ...) into `policy.tools`,
// so a run whose callable tools are read-only (crypto-price, web-search) still
// carries a non-empty `tools` set.
//
// Contract since audit G2 (747b05e5f): a refusal is NOT an Effect failure. It
// fails inside `runStrategy`, which mints a result with `status: "failed"` and
// the refusal text on `result.error` (contains `code-action cannot honor`). The
// probe reads that field; an Effect `Left` is reported as an instrument fault.
//
// Fixture: the stub model answers with the async IIFE form the plan prompt
// demands (code-action-plan.ts). A bare `return ...` block is a syntax error in
// the sandbox, so every arm used to end `failed` for that reason alone and the
// probe could not tell a refusal from a broken script.
//
// Arms (TestLLMService, no network):
//   A  policy.tools = {file-write},   callable = [crypto-price]   (Cortex shape)  expect refused=false
//   B  policy.tools = {},             callable = [crypto-price]   (control)       expect refused=false
//   C  no policy,                     callable = [crypto-price]   (control)       expect refused=false
//   D  policy.tools = {crypto-price}, callable = [crypto-price]   (gated-callable) expect refused=true
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

const IIFE_REPLY = "```javascript\n(async () => {\n  return 'BTC 1';\n})()\n```";

type Policy = Parameters<typeof buildRunEnvelope>[0]["approvalPolicy"];

const arm = async (label: string, approvalPolicy: Policy | undefined, expectRefused: boolean): Promise<boolean> => {
  const program = executeCodeAction({
    taskDescription: "Find the current price of BTC and report it",
    taskType: "simple",
    memoryContext: "",
    availableTools: ["crypto-price"],
    availableToolSchemas: [CRYPTO],
    config: defaultReasoningConfig,
  }).pipe(Effect.either, Effect.provide(TestLLMServiceLayer([{ text: IIFE_REPLY }, { text: IIFE_REPLY }, { text: IIFE_REPLY }])));
  const result = await Effect.runPromise(
    provideTestEnvelope(program, buildRunEnvelope(approvalPolicy ? { approvalPolicy } : {})),
  );
  if (Either.isLeft(result)) {
    console.log(`${label}\tINSTRUMENT-FAULT\tEffect failed (pre-G2 contract): ${String(result.left.message).slice(0, 90)}`);
    return false;
  }
  const { status, error } = result.right;
  // The substrate wraps the refusal: "Strategy execution failed (code-action): code-action cannot honor ...".
  const refused = status === "failed" && typeof error === "string" && error.includes("code-action cannot honor");
  const detail = `status=${status}${error ? ` error=${error.slice(0, 80)}` : ""}`;
  const ok = refused === expectRefused;
  console.log(`${label}\trefused=${refused}\texpect=${expectRefused}\t${ok ? "OK" : "MISMATCH"}\t${detail}`);
  return ok;
};

const results = [
  await arm("A gated-not-callable", { mode: "detach", tools: new Set(["file-write"]) }, false),
  await arm("B empty-policy      ", { mode: "detach", tools: new Set<string>() }, false),
  await arm("C no-policy         ", undefined, false),
  await arm("D gated-callable    ", { mode: "detach", tools: new Set(["crypto-price"]) }, true),
];
if (results.some((ok) => !ok)) process.exitCode = 1;
