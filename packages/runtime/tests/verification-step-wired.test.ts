/**
 * P0-8 regression pin: `.withVerificationStep({ mode: "reflect" })` is WIRED.
 *
 * Before the fix, the reflect pass burned a real LLM call and wrote its verdict
 * to `ctx.metadata.verificationFeedback` — a field with ZERO readers. The user
 * paid tokens for a value nothing consumed.
 *
 * Now a `REVISE:` verdict feeds back as a continuation signal: the harness
 * re-runs once with the verification feedback injected, so the final answer
 * addresses the gap the verify pass found.
 *
 * Migrated off the dead inline arm (Move 1, 2026-08-13) onto the kernel arm's
 * equivalent mechanism, `reasoning-harness-hooks.ts`'s reflect-mode
 * verify+revise block — a deliberate mirror of the old inline-harness-hooks.ts
 * logic (same `needsRevision` → re-run-with-feedback shape), already wired at
 * `execution-engine.ts`'s reasoning-arm branch. This test drives the engine
 * with a content-aware STUB `ReasoningService` (not `LLMService` — the verify
 * and revise calls both go through `reasoningOpt.value.execute()`) and asserts
 * the output was actually revised.
 *
 * Red-on-cut: delete the `if (needsRevision) { ...re-run... }` block in
 * reasoning-harness-hooks.ts and the output stays the un-revised "initial
 * answer".
 */
import { describe, it, expect } from "bun:test";
import { Effect, Layer, Context } from "effect";
import { defaultReactiveAgentsConfig } from "../src/types.js";
import {
  ExecutionEngine,
  ExecutionEngineLive,
  LifecycleHookRegistryLive,
} from "../src/index.js";

type StubReasoningResult = {
  output: unknown;
  status: "completed" | "failed" | "partial";
  steps?: readonly { id: string; type: string; content: string }[];
  metadata: { cost: number; tokensUsed: number; stepsCount: number };
};

const ReasoningServiceTag = Context.GenericTag<{
  execute: (params: { [k: string]: unknown }) => Effect.Effect<StubReasoningResult>;
}>("ReasoningService");

const INITIAL = "initial answer without the keyword";
const REVISE_VERDICT = "REVISE: the answer must mention BANANA";
const REVISED = "Final answer: BANANA is now included.";

/**
 * Content-aware stub ReasoningService: the reflect-mode verify prompt (built
 * in reasoning-harness-hooks.ts around line 239, carrying "Respond PASS")
 * gets a REVISE verdict; the follow-up continuation carrying that verdict in
 * its `initialMessages` gets the revised answer; anything else (the initial
 * think pass) gets the un-revised initial answer.
 */
function makeVerifyReasoningStub(): { layer: Layer.Layer<never, never, never>; callCount: () => number } {
  let calls = 0;
  return {
    layer: Layer.succeed(ReasoningServiceTag, {
      execute: (params: { [k: string]: unknown }) => {
        calls++;
        const s = JSON.stringify(params);
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
          output: content,
          status: "completed" as const,
          steps: [{ id: `step-${calls}`, type: "thought", content }],
          metadata: { cost: 0, tokensUsed: 10, stepsCount: 1 },
        });
      },
    }),
    callCount: () => calls,
  };
}

async function runTask(
  config: ReturnType<typeof defaultReactiveAgentsConfig>,
  reasoningLayer: Layer.Layer<never, never, never>,
) {
  const engineLayer = ExecutionEngineLive(config).pipe(Layer.provide(LifecycleHookRegistryLive));
  const runLayer = Layer.mergeAll(engineLayer, reasoningLayer);
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
    const mock = makeVerifyReasoningStub();
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
    // initial + verify + revise = at least 3 ReasoningService calls.
    expect(mock.callCount()).toBeGreaterThanOrEqual(3);
  });
});
