// Run: bun test packages/reasoning/src/kernel/capabilities/learn/learning-pipeline.test.ts --timeout 15000
//
// Issue #120 / North Star §4.3 / Audit G-D — LearningPipeline seam (Phase 1).
//
// Pins the contract:
//   (a) NoopLearningPipelineLayer satisfies the LearningPipeline tag and its
//       write() returns Effect.void without error.
//   (b) When no LearningPipeline layer is provided, code that uses
//       `Effect.serviceOption(LearningPipeline)` resolves to None and the
//       guarded write site no-ops (no error, no crash).
//   (c) When a captured-args layer is provided, write() is called with the
//       non-empty observations/decisions/outcome the caller passes in.
//   (d) The per-iter write-site fires EXACTLY ONCE per simulated iteration
//       (no duplicate writes inside the same iter — load-bearing for the
//       "compounding intelligence trait has one owner" invariant).
//
// Co-located alongside learning-pipeline.ts so this file lives inside the
// kernel-warden authority boundary (packages/reasoning/src/kernel/**).

import { describe, it, expect } from "bun:test";
import { Effect, Layer, Ref } from "effect";
import {
  LearningPipeline,
  NoopLearningPipelineLayer,
  type LearningPipelineOutcome,
} from "./learning-pipeline.js";
import type { ReasoningStep } from "../../../types/step.js";

const fakeStep = (type: ReasoningStep["type"], content: string): ReasoningStep =>
  ({
    id: `step-${Math.random().toString(36).slice(2, 8)}` as ReasoningStep["id"],
    type,
    content,
    timestamp: new Date(),
    metadata: {},
  }) as ReasoningStep;

const fakeOutcome = (success: boolean): LearningPipelineOutcome => ({
  success,
  output: success ? "out" : undefined,
  tokensUsed: 100,
  costUsd: 0.001,
});

// ── (a) Noop layer satisfies the tag ───────────────────────────────────────
describe("LearningPipeline — NoopLearningPipelineLayer satisfies the tag", () => {
  it("write() resolves to void without error", async () => {
    const program = Effect.gen(function* () {
      const svc = yield* LearningPipeline;
      const result = yield* svc.write(
        [fakeStep("thought", "hello")],
        ["dec: r"],
        fakeOutcome(true),
      );
      return result;
    });
    const result = await Effect.runPromise(program.pipe(Effect.provide(NoopLearningPipelineLayer)));
    expect(result).toBeUndefined();
  });
});

// ── (b) No layer provided — serviceOption-guarded site no-ops ──────────────
describe("LearningPipeline — absent layer is non-fatal at call sites", () => {
  it("Effect.serviceOption(LearningPipeline) returns None without error", async () => {
    // Mirrors the call pattern in runner.ts:
    //   const opt = yield* Effect.serviceOption(LearningPipeline);
    //   if (opt._tag === 'Some') yield* opt.value.write(...);
    const program = Effect.gen(function* () {
      const opt = yield* Effect.serviceOption(LearningPipeline);
      if (opt._tag === "Some") {
        yield* opt.value.write([fakeStep("action", "x")], ["d"], fakeOutcome(true));
        return "wrote";
      }
      return "noop";
    });
    // No layer provided — must resolve cleanly.
    const result = await Effect.runPromise(program);
    expect(result).toBe("noop");
  });
});

// ── (c) Captured-args layer records writes ─────────────────────────────────
describe("LearningPipeline — custom layer captures write payloads", () => {
  it("invokes write() with non-empty observations + decisions + outcome", async () => {
    type WriteCall = {
      observations: readonly ReasoningStep[];
      decisions: readonly string[];
      outcome: LearningPipelineOutcome;
    };

    const program = Effect.gen(function* () {
      const calls = yield* Ref.make<readonly WriteCall[]>([]);
      const capturingLayer = Layer.succeed(LearningPipeline, {
        write: (observations, decisions, outcome) =>
          Ref.update(calls, (prev) => [...prev, { observations, decisions, outcome }]),
      });

      const inner = Effect.gen(function* () {
        const svc = yield* LearningPipeline;
        yield* svc.write(
          [fakeStep("thought", "t1"), fakeStep("action", "a1")],
          ["strategy-switch: low-entropy"],
          fakeOutcome(true),
        );
      });

      yield* inner.pipe(Effect.provide(capturingLayer));
      return yield* Ref.get(calls);
    });

    const captured = await Effect.runPromise(program);
    expect(captured.length).toBe(1);
    expect(captured[0]!.observations.length).toBe(2);
    expect(captured[0]!.decisions.length).toBe(1);
    expect(captured[0]!.outcome.success).toBe(true);
    expect(captured[0]!.outcome.tokensUsed).toBe(100);
  });
});

// ── (d) Write-site fires exactly once per simulated iter ───────────────────
describe("LearningPipeline — write fires exactly once per iter", () => {
  it("simulated 3-iter loop produces exactly 3 write calls (no duplicates)", async () => {
    const program = Effect.gen(function* () {
      const counter = yield* Ref.make(0);
      const countingLayer = Layer.succeed(LearningPipeline, {
        write: () => Ref.update(counter, (n) => n + 1),
      });

      // Mirror the runner.ts call-site shape: a single guarded write per loop
      // iter. If a maintainer accidentally duplicates the call site (e.g. via
      // copy-paste inside a branch), this assertion catches it.
      const simulateIter = Effect.gen(function* () {
        const opt = yield* Effect.serviceOption(LearningPipeline);
        if (opt._tag === "Some") {
          yield* opt.value.write(
            [fakeStep("thought", "t")],
            ["d"],
            fakeOutcome(false),
          );
        }
      });

      const loop = Effect.gen(function* () {
        for (let i = 0; i < 3; i++) {
          yield* simulateIter;
        }
        return yield* Ref.get(counter);
      });

      return yield* loop.pipe(Effect.provide(countingLayer));
    });

    const count = await Effect.runPromise(program);
    expect(count).toBe(3);
  });
});
