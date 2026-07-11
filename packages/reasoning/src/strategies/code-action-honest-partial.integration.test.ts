// Run: bun test packages/reasoning/src/strategies/code-action-honest-partial.integration.test.ts --timeout 20000
//
// #40 / spec §1b (CompletionEnvelope) — code-action derives completion from
// its deterministic verifier evidence, not from "the sandbox returned".
//
// code-action runs NO sub-kernel (sandbox Worker + verifier gate), so its
// envelope derives from the path's own DETERMINISTIC evidence (#40 rule 5):
// the final verifier verdict. Before #40 the strategy hardcoded
// `status:"completed"` — a run that exhausted its iteration cap with a
// FAILING verifier verdict still shipped as a clean success. Strip the
// verdict-derived status / verificationWarning at code-action's return site
// and these go red.

import { describe, expect, it } from "bun:test";
import { Effect, Layer } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { executeCodeAction } from "./code-action.js";
import { defaultReasoningConfig } from "../types/config.js";
import type {
  Verifier,
  VerificationContext,
  VerificationResult,
} from "../kernel/capabilities/verify/verifier.js";

// Deterministic code block: no tool calls, resolves immediately in the sandbox.
const CODE_RESPONSE =
  '```typescript\n(async () => { return "result-token"; })()\n```';

// A verifier that always rejects — the deterministic FAIL evidence.
const alwaysFailVerifier: Verifier = {
  verify(ctx: VerificationContext): VerificationResult {
    return {
      verified: false,
      checks: [{ name: "always-fail", passed: false, severity: "reject" }],
      summary: "deliverable did not meet the acceptance bar",
      action: ctx.action,
      softFail: false,
      severity: "reject",
    };
  },
};

// Cap the retry loop at 1 iteration so the FAIL run terminates deterministically
// on iteration exhaustion (shouldTerminate: iteration >= maxIterations).
const oneIterationConfig = {
  ...defaultReasoningConfig,
  strategies: {
    ...defaultReasoningConfig.strategies,
    reactive: {
      ...defaultReasoningConfig.strategies.reactive,
      maxIterations: 1,
    },
  },
};

const runCodeAction = (extra: Record<string, unknown>) =>
  Effect.runPromise(
    executeCodeAction({
      taskDescription: "Compute the result token.",
      taskType: "code",
      memoryContext: "",
      availableTools: [],
      config: oneIterationConfig,
      ...extra,
    } as never).pipe(
      Effect.provide(Layer.merge(TestLLMServiceLayer([{ text: CODE_RESPONSE }]), Layer.empty)),
    ),
  );

describe("#40 (code-action) — a failing verifier verdict never ships as completed", () => {
  it("iteration cap exhausted with FAIL verdict: result.status is PARTIAL with the warning", async () => {
    const result = await runCodeAction({ verifier: alwaysFailVerifier });

    // The sandbox result is preserved…
    expect(String(result.output)).toContain("result-token");
    // …but the caller is told the truth: the verifier never blessed it.
    expect(result.status).toBe("partial");
    const meta = result.metadata as Record<string, unknown>;
    expect(String(meta.verificationWarning ?? "")).toContain("failing verifier verdict");
  });

  it("CONTROL: the default (noop) verifier still reports completed with no warning", async () => {
    const result = await runCodeAction({});
    expect(result.status).toBe("completed");
    const meta = result.metadata as Record<string, unknown>;
    expect(meta.verificationWarning).toBeUndefined();
  });
});
