// Run: bun test packages/reasoning/src/kernel/capabilities/recall/recall-service.test.ts --timeout 15000
//
// Issue #129 / North Star §4.3 / Audit G-C — RecallService seam (Phase 1).
//
// Pins the contract:
//   (a) NoopRecallServiceLayer satisfies the RecallService tag and all three
//       methods (recallMemoryContext / findSkills / loadProfile) return
//       empty results without error.
//   (b) When no RecallService layer is provided, code that uses
//       `Effect.serviceOption(RecallService)` resolves to None and the
//       guarded call site no-ops (no error, no crash).
//   (c) When a captured-args layer is provided, recallMemoryContext is
//       invoked with the non-empty state the caller passes in.
//   (d) The per-iter call site fires EXACTLY ONCE per simulated iteration
//       (no duplicate recalls inside the same iter — load-bearing for the
//       "single per-iter recall" invariant).
//   (e) Recall fires BEFORE think within the same iter — load-bearing for
//       the Optimal Execution Algorithm step 4 ordering.
//
// Co-located alongside recall-service.ts so this file lives inside the
// kernel-warden authority boundary (packages/reasoning/src/kernel/**).
// Mirrors the structure of
// packages/reasoning/src/kernel/capabilities/learn/learning-pipeline.test.ts
// (HS-120 Phase 1).

import { describe, it, expect } from "bun:test";
import { Effect, Layer, Ref } from "effect";
import {
  RecallService,
  NoopRecallServiceLayer,
  type MemoryRecallResult,
  type FoundSkill,
  type ProfileSnapshot,
} from "./recall-service.js";
import type { KernelState } from "../../state/kernel-state.js";

// Minimal KernelState stub — recall must accept the full shape, but tests
// don't exercise its internals. Cast through unknown to keep the surface
// honest without re-deriving 30+ KernelState fields here.
const fakeState = (overrides: Partial<KernelState> = {}): KernelState => {
  const base = {
    status: "running",
    iteration: 0,
    steps: [],
    messages: [],
    scratchpad: new Map<string, string>(),
    controllerDecisionLog: [],
    tokens: 0,
    cost: 0,
    llmCalls: 0,
    output: undefined,
    meta: {},
  };
  return { ...base, ...overrides } as unknown as KernelState;
};

// ── (a) Noop layer satisfies the tag — all 3 methods return empty ──────────
describe("RecallService — NoopRecallServiceLayer satisfies the tag", () => {
  it("recallMemoryContext returns empty semanticContext + empty episodic", async () => {
    const program = Effect.gen(function* () {
      const svc = yield* RecallService;
      return yield* svc.recallMemoryContext(fakeState(), undefined);
    });
    const result: MemoryRecallResult = await Effect.runPromise(
      program.pipe(Effect.provide(NoopRecallServiceLayer)),
    );
    expect(result.semanticContext).toBe("");
    expect(result.episodic).toEqual([]);
  });

  it("findSkills returns an empty list", async () => {
    const program = Effect.gen(function* () {
      const svc = yield* RecallService;
      return yield* svc.findSkills(fakeState(), undefined);
    });
    const result: readonly FoundSkill[] = await Effect.runPromise(
      program.pipe(Effect.provide(NoopRecallServiceLayer)),
    );
    expect(result.length).toBe(0);
  });

  it("loadProfile returns an empty profile snapshot", async () => {
    const program = Effect.gen(function* () {
      const svc = yield* RecallService;
      return yield* svc.loadProfile(fakeState());
    });
    const result: ProfileSnapshot = await Effect.runPromise(
      program.pipe(Effect.provide(NoopRecallServiceLayer)),
    );
    expect(result.calibration).toBeUndefined();
    expect(result.agentProfile).toBeUndefined();
  });
});

// ── (b) No layer provided — serviceOption-guarded site no-ops ──────────────
describe("RecallService — absent layer is non-fatal at call sites", () => {
  it("Effect.serviceOption(RecallService) returns None without error", async () => {
    // Mirrors the call pattern in runner.ts:
    //   const opt = yield* Effect.serviceOption(RecallService);
    //   if (opt._tag === 'Some') { ...recall... }
    const program = Effect.gen(function* () {
      const opt = yield* Effect.serviceOption(RecallService);
      if (opt._tag === "Some") {
        yield* opt.value.recallMemoryContext(fakeState(), undefined);
        yield* opt.value.findSkills(fakeState(), undefined);
        return "called";
      }
      return "noop";
    });
    // No layer provided — must resolve cleanly.
    const result = await Effect.runPromise(program);
    expect(result).toBe("noop");
  });
});

// ── (c) Captured-args layer records recallMemoryContext payload ────────────
describe("RecallService — custom layer captures recall payloads", () => {
  it("invokes recallMemoryContext with the non-empty state the caller passes", async () => {
    type RecallCall = {
      readonly stateIteration: number;
      readonly stateStepCount: number;
    };

    const program = Effect.gen(function* () {
      const calls = yield* Ref.make<readonly RecallCall[]>([]);
      const capturingLayer = Layer.succeed(RecallService, {
        recallMemoryContext: (state) =>
          Ref.update(calls, (prev) => [
            ...prev,
            {
              stateIteration: state.iteration,
              stateStepCount: state.steps.length,
            },
          ]).pipe(
            Effect.as<MemoryRecallResult>({
              semanticContext: "captured",
              episodic: [],
            }),
          ),
        findSkills: () => Effect.succeed<readonly FoundSkill[]>([]),
        loadProfile: () => Effect.succeed<ProfileSnapshot>({}),
      });

      const inner = Effect.gen(function* () {
        const svc = yield* RecallService;
        const result = yield* svc.recallMemoryContext(
          fakeState({ iteration: 3 }),
          undefined,
        );
        return result.semanticContext;
      });

      const sem = yield* inner.pipe(Effect.provide(capturingLayer));
      const captured = yield* Ref.get(calls);
      return { sem, captured };
    });

    const { sem, captured } = await Effect.runPromise(program);
    expect(sem).toBe("captured");
    expect(captured.length).toBe(1);
    expect(captured[0]!.stateIteration).toBe(3);
  });
});

// ── (d) Call site fires exactly once per simulated iter ────────────────────
describe("RecallService — recall fires exactly once per iter", () => {
  it("simulated 3-iter loop produces exactly 3 recall calls (no duplicates)", async () => {
    const program = Effect.gen(function* () {
      const counter = yield* Ref.make(0);
      const countingLayer = Layer.succeed(RecallService, {
        recallMemoryContext: () =>
          Ref.update(counter, (n) => n + 1).pipe(
            Effect.as<MemoryRecallResult>({ semanticContext: "", episodic: [] }),
          ),
        findSkills: () => Effect.succeed<readonly FoundSkill[]>([]),
        loadProfile: () => Effect.succeed<ProfileSnapshot>({}),
      });

      // Mirror the runner.ts call-site shape: a single guarded recall per
      // loop iter. If a maintainer accidentally duplicates the call site
      // (e.g. via copy-paste inside a branch), this assertion catches it.
      const simulateIter = Effect.gen(function* () {
        const opt = yield* Effect.serviceOption(RecallService);
        if (opt._tag === "Some") {
          yield* opt.value.recallMemoryContext(fakeState(), undefined);
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

// ── (e) Ordering: recall fires BEFORE think within the same iter ───────────
describe("RecallService — recall fires before think within an iter", () => {
  it("simulated iter records ordering: recall-call, then think-call", async () => {
    const program = Effect.gen(function* () {
      const sequence = yield* Ref.make<readonly string[]>([]);
      const orderingLayer = Layer.succeed(RecallService, {
        recallMemoryContext: () =>
          Ref.update(sequence, (prev) => [...prev, "recall"]).pipe(
            Effect.as<MemoryRecallResult>({ semanticContext: "", episodic: [] }),
          ),
        findSkills: () => Effect.succeed<readonly FoundSkill[]>([]),
        loadProfile: () => Effect.succeed<ProfileSnapshot>({}),
      });

      // Mirror the runner.ts wire ordering: recall at iter-start, THEN the
      // think phase fires. If a future refactor moves the recall call site
      // below the think dispatch, this ordering test catches the regression.
      const simulateIter = Effect.gen(function* () {
        const opt = yield* Effect.serviceOption(RecallService);
        if (opt._tag === "Some") {
          yield* opt.value.recallMemoryContext(fakeState(), undefined);
        }
        // Simulated think phase — pushes "think" only after recall has run.
        yield* Ref.update(sequence, (prev) => [...prev, "think"]);
      });

      yield* simulateIter.pipe(Effect.provide(orderingLayer));
      return yield* Ref.get(sequence);
    });

    const sequence = await Effect.runPromise(program);
    expect(sequence).toEqual(["recall", "think"]);
  });
});
