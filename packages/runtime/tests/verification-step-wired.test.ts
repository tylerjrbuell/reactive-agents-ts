/**
 * P0-8 regression pin: `.withVerificationStep({ mode: "reflect" })` is WIRED.
 *
 * Before the fix, the reflect pass burned a real LLM call and wrote its verdict
 * to `ctx.metadata.verificationFeedback` — a field with ZERO readers. The user
 * paid tokens for a value nothing consumed.
 *
 * Now a `REVISE:` verdict feeds back as a continuation signal: the harness
 * re-runs once with the verification feedback injected, so the final answer
 * addresses the gap the verify pass found. This test drives the full engine
 * (inline harness path — no ReasoningService in the layer) with a
 * content-aware mock and asserts the output was actually revised.
 *
 * Red-on-cut: delete the `if (needsRevision) { ...re-run... }` block in
 * inline-harness-hooks.ts and the output stays the un-revised "initial answer".
 */
import { describe, it, expect } from "bun:test";
import { Effect, Layer, Context } from "effect";
import { defaultReactiveAgentsConfig } from "../src/types.js";
import {
  ExecutionEngine,
  ExecutionEngineLive,
  LifecycleHookRegistryLive,
} from "../src/index.js";

type LLMShape = {
  complete: (req: unknown) => Effect.Effect<{
    content: string;
    stopReason: string;
    usage: { inputTokens: number; outputTokens: number; totalTokens: number; estimatedCost: number };
    model: string;
  }>;
};
const LLMTag = Context.GenericTag<LLMShape>("LLMService");

const INITIAL = "initial answer without the keyword";
const REVISE_VERDICT = "REVISE: the answer must mention BANANA";
const REVISED = "Final answer: BANANA is now included.";

/** Content-aware mock: verify prompt → REVISE; continuation → revised answer. */
function makeVerifyMock(): { layer: Layer.Layer<LLMShape>; callCount: () => number } {
  let calls = 0;
  return {
    layer: Layer.succeed(LLMTag, {
      complete: (req: unknown) => {
        calls++;
        const s = JSON.stringify(req);
        let content: string;
        if (s.includes("Respond PASS")) {
          // The reflect-mode verification prompt.
          content = REVISE_VERDICT;
        } else if (s.includes("must mention BANANA")) {
          // The continuation re-run carrying the REVISE feedback.
          content = REVISED;
        } else {
          content = INITIAL;
        }
        return Effect.succeed({
          content,
          stopReason: "end_turn",
          usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20, estimatedCost: 0 },
          model: "test",
        });
      },
    }),
    callCount: () => calls,
  };
}

async function runTask(config: ReturnType<typeof defaultReactiveAgentsConfig>, llmLayer: Layer.Layer<LLMShape>) {
  const engineLayer = ExecutionEngineLive(config).pipe(Layer.provide(LifecycleHookRegistryLive));
  const runLayer = Layer.mergeAll(engineLayer, llmLayer);
  return Effect.runPromise(
    ExecutionEngine.pipe(
      Effect.flatMap((engine) =>
        engine.execute({
          id: `task-${Date.now()}` as any,
          agentId: config.agentId as any,
          input: "answer the question",
          type: "query" as const,
          priority: "medium" as const,
          status: "pending" as const,
          metadata: { tags: [] },
          createdAt: new Date(),
        } as any),
      ),
      Effect.provide(runLayer),
    ),
  );
}

describe("withVerificationStep — P0-8 REVISE verdict changes the output", () => {
  it("re-runs with feedback and surfaces the revised answer", async () => {
    const mock = makeVerifyMock();
    const config = defaultReactiveAgentsConfig("verify-wired-agent", {
      maxIterations: 5,
      verificationStep: { mode: "reflect" },
    });

    const result = await runTask(config, mock.layer);
    const output = String(result.output ?? "");

    // The verdict CHANGED the run: the final output is the revised answer, not
    // the initial one. This is the reader that makes the verify call worth its
    // tokens.
    expect(output).toContain("BANANA");
    expect(output).not.toBe(INITIAL);
    // initial + verify + revise = at least 3 LLM calls.
    expect(mock.callCount()).toBeGreaterThanOrEqual(3);
  });
});
