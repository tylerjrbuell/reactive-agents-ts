/**
 * Extended ExperimentService tests — deeper coverage of variant assignment,
 * outcome aggregation, status lifecycle, winner selection, and edge cases.
 */
import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import {
  ExperimentService,
  ExperimentServiceLive,
} from "../src/services/experiment-service.js";

const runWithService = <A>(
  effect: Effect.Effect<A, never, ExperimentService>,
): Promise<A> =>
  Effect.runPromise(Effect.provide(effect, ExperimentServiceLive));

// ─── Experiment Creation ───

describe("ExperimentService — creation", () => {
  test("auto-increments experiment IDs", async () => {
    const { id1, id2 } = await runWithService(
      Effect.gen(function* () {
        const svc = yield* ExperimentService;
        const e1 = yield* svc.createExperiment("tpl", { a: 1 });
        const e2 = yield* svc.createExperiment("tpl", { b: 2 });
        return { id1: e1.id, id2: e2.id };
      }),
    );
    expect(id1).toBe("exp-1");
    expect(id2).toBe("exp-2");
  });

  test("creates experiment with three variants and equal split", async () => {
    const exp = await runWithService(
      Effect.gen(function* () {
        const svc = yield* ExperimentService;
        return yield* svc.createExperiment("tpl", { a: 1, b: 2, c: 3 });
      }),
    );
    expect(exp.variants.size).toBe(3);
    const ratio = 1 / 3;
    for (const [, r] of exp.splitRatio) {
      expect(r).toBeCloseTo(ratio, 5);
    }
  });

  test("new experiment defaults to active status", async () => {
    const exp = await runWithService(
      Effect.gen(function* () {
        const svc = yield* ExperimentService;
        return yield* svc.createExperiment("tpl", { a: 1 });
      }),
    );
    expect(exp.status).toBe("active");
  });

  test("createdAt is set to a Date", async () => {
    const before = new Date();
    const exp = await runWithService(
      Effect.gen(function* () {
        const svc = yield* ExperimentService;
        return yield* svc.createExperiment("tpl", { a: 1 });
      }),
    );
    const after = new Date();
    expect(exp.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(exp.createdAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });
});

// ─── Variant Assignment ───

describe("ExperimentService — variant assignment", () => {
  test("same user always gets same variant (sticky assignment)", async () => {
    const results = await runWithService(
      Effect.gen(function* () {
        const svc = yield* ExperimentService;
        const exp = yield* svc.createExperiment("tpl", { a: 1, b: 2 });
        const assignments: string[] = [];
        for (let i = 0; i < 10; i++) {
          const a = yield* svc.assignVariant(exp.id, "same-user");
          assignments.push(a!.variant);
        }
        return assignments;
      }),
    );
    // All assignments should be identical
    const unique = new Set(results);
    expect(unique.size).toBe(1);
  });

  test("returns null for non-existent experiment", async () => {
    const result = await runWithService(
      Effect.gen(function* () {
        const svc = yield* ExperimentService;
        return yield* svc.assignVariant("nonexistent", "user-1");
      }),
    );
    expect(result).toBeNull();
  });

  test("returns null for completed experiment", async () => {
    const result = await runWithService(
      Effect.gen(function* () {
        const svc = yield* ExperimentService;
        const exp = yield* svc.createExperiment("tpl", { a: 1 });
        yield* svc.updateStatus(exp.id, "completed");
        return yield* svc.assignVariant(exp.id, "user-1");
      }),
    );
    expect(result).toBeNull();
  });

  test("assignment includes correct version number", async () => {
    const result = await runWithService(
      Effect.gen(function* () {
        const svc = yield* ExperimentService;
        const exp = yield* svc.createExperiment("tpl", { control: 5, variant: 10 });
        return yield* svc.assignVariant(exp.id, "user-abc");
      }),
    );
    expect(result).not.toBeNull();
    if (result!.variant === "control") {
      expect(result!.version).toBe(5);
    } else {
      expect(result!.version).toBe(10);
    }
  });

  test("custom split ratio biases assignment", async () => {
    const counts = await runWithService(
      Effect.gen(function* () {
        const svc = yield* ExperimentService;
        // 90% control, 10% variant
        const exp = yield* svc.createExperiment(
          "tpl",
          { control: 1, variant: 2 },
          { control: 0.9, variant: 0.1 },
        );

        const c: Record<string, number> = { control: 0, variant: 0 };
        for (let i = 0; i < 200; i++) {
          const a = yield* svc.assignVariant(exp.id, `bias-user-${i}`);
          if (a) c[a.variant]!++;
        }
        return c;
      }),
    );
    // With 90/10 split, control should get significantly more
    expect(counts.control).toBeGreaterThan(counts.variant);
    expect(counts.control).toBeGreaterThan(100); // should be ~180
  });
});

// ─── Status Lifecycle ───

describe("ExperimentService — status lifecycle", () => {
  test("can transition active → paused → active", async () => {
    const statuses = await runWithService(
      Effect.gen(function* () {
        const svc = yield* ExperimentService;
        const exp = yield* svc.createExperiment("tpl", { a: 1 });
        const s1 = exp.status;

        yield* svc.updateStatus(exp.id, "paused");
        // Verify paused — assignVariant returns null
        const a1 = yield* svc.assignVariant(exp.id, "user-1");

        yield* svc.updateStatus(exp.id, "active");
        const a2 = yield* svc.assignVariant(exp.id, "user-2");

        return { s1, pausedAssignment: a1, activeAssignment: a2 };
      }),
    );
    expect(statuses.s1).toBe("active");
    expect(statuses.pausedAssignment).toBeNull();
    expect(statuses.activeAssignment).not.toBeNull();
  });

  test("can complete an experiment", async () => {
    const result = await runWithService(
      Effect.gen(function* () {
        const svc = yield* ExperimentService;
        const exp = yield* svc.createExperiment("tpl", { a: 1 });
        yield* svc.updateStatus(exp.id, "completed");
        return yield* svc.assignVariant(exp.id, "user-1");
      }),
    );
    expect(result).toBeNull();
  });

  test("updateStatus on non-existent experiment is a no-op", async () => {
    // Should not throw
    await runWithService(
      Effect.gen(function* () {
        const svc = yield* ExperimentService;
        yield* svc.updateStatus("nonexistent-id", "paused");
      }),
    );
  });
});

// ─── Outcome Recording & Results ───

describe("ExperimentService — outcomes and results", () => {
  test("records outcome with metadata", async () => {
    const results = await runWithService(
      Effect.gen(function* () {
        const svc = yield* ExperimentService;
        const exp = yield* svc.createExperiment("tpl", { a: 1, b: 2 });
        yield* svc.assignVariant(exp.id, "user-1");
        yield* svc.recordOutcome(exp.id, "a", "user-1", {
          success: true,
          score: 0.95,
          metadata: { latencyMs: 150 },
        });
        return yield* svc.getExperimentResults(exp.id);
      }),
    );
    expect(results).not.toBeNull();
    expect(results!.totalOutcomes).toBe(1);
  });

  test("winner is selected when variant has 5+ outcomes and good score", async () => {
    const results = await runWithService(
      Effect.gen(function* () {
        const svc = yield* ExperimentService;
        const exp = yield* svc.createExperiment("tpl", { good: 1, bad: 2 });

        // Record 10 outcomes for "good" (100% success, score 0.9)
        for (let i = 0; i < 10; i++) {
          const uid = `good-user-${i}`;
          yield* svc.assignVariant(exp.id, uid);
          yield* svc.recordOutcome(exp.id, "good", uid, {
            success: true,
            score: 0.9,
          });
        }

        // Record 10 outcomes for "bad" (0% success, score 0.1)
        for (let i = 0; i < 10; i++) {
          const uid = `bad-user-${i}`;
          yield* svc.assignVariant(exp.id, uid);
          yield* svc.recordOutcome(exp.id, "bad", uid, {
            success: false,
            score: 0.1,
          });
        }

        return yield* svc.getExperimentResults(exp.id);
      }),
    );
    expect(results!.winner).toBe("good");
  });

  test("success rate is computed correctly", async () => {
    const results = await runWithService(
      Effect.gen(function* () {
        const svc = yield* ExperimentService;
        const exp = yield* svc.createExperiment("tpl", { a: 1 });

        for (let i = 0; i < 10; i++) {
          const uid = `user-${i}`;
          yield* svc.assignVariant(exp.id, uid);
          yield* svc.recordOutcome(exp.id, "a", uid, {
            success: i < 7, // 7 successes out of 10
            score: 0.5,
          });
        }

        return yield* svc.getExperimentResults(exp.id);
      }),
    );
    expect(results!.variants["a"]!.successRate).toBeCloseTo(0.7, 2);
    expect(results!.variants["a"]!.outcomes).toBe(10);
  });

  test("avg score is computed correctly", async () => {
    const results = await runWithService(
      Effect.gen(function* () {
        const svc = yield* ExperimentService;
        const exp = yield* svc.createExperiment("tpl", { a: 1 });

        const scores = [0.2, 0.4, 0.6, 0.8, 1.0];
        for (let i = 0; i < scores.length; i++) {
          const uid = `user-${i}`;
          yield* svc.assignVariant(exp.id, uid);
          yield* svc.recordOutcome(exp.id, "a", uid, {
            success: true,
            score: scores[i],
          });
        }

        return yield* svc.getExperimentResults(exp.id);
      }),
    );
    expect(results!.variants["a"]!.avgScore).toBeCloseTo(0.6, 2);
  });

  test("variant with no outcomes has zero rates", async () => {
    const results = await runWithService(
      Effect.gen(function* () {
        const svc = yield* ExperimentService;
        const exp = yield* svc.createExperiment("tpl", { a: 1, b: 2 });
        return yield* svc.getExperimentResults(exp.id);
      }),
    );
    expect(results!.variants["a"]!.successRate).toBe(0);
    expect(results!.variants["a"]!.avgScore).toBe(0);
    expect(results!.variants["a"]!.outcomes).toBe(0);
  });

  test("outcomes without scores produce avgScore of 0", async () => {
    const results = await runWithService(
      Effect.gen(function* () {
        const svc = yield* ExperimentService;
        const exp = yield* svc.createExperiment("tpl", { a: 1 });

        for (let i = 0; i < 6; i++) {
          const uid = `user-${i}`;
          yield* svc.assignVariant(exp.id, uid);
          yield* svc.recordOutcome(exp.id, "a", uid, {
            success: true,
            // No score provided
          });
        }

        return yield* svc.getExperimentResults(exp.id);
      }),
    );
    expect(results!.variants["a"]!.avgScore).toBe(0);
    expect(results!.variants["a"]!.successRate).toBe(1.0);
  });
});

// ─── Listing ───

describe("ExperimentService — listing", () => {
  test("lists all experiments when no templateId filter", async () => {
    const all = await runWithService(
      Effect.gen(function* () {
        const svc = yield* ExperimentService;
        yield* svc.createExperiment("t1", { a: 1 });
        yield* svc.createExperiment("t2", { b: 2 });
        yield* svc.createExperiment("t3", { c: 3 });
        return yield* svc.listExperiments();
      }),
    );
    expect(all.length).toBe(3);
  });

  test("returns empty array when no experiments exist", async () => {
    const all = await runWithService(
      Effect.gen(function* () {
        const svc = yield* ExperimentService;
        return yield* svc.listExperiments();
      }),
    );
    expect(all.length).toBe(0);
  });

  test("filters by templateId", async () => {
    const filtered = await runWithService(
      Effect.gen(function* () {
        const svc = yield* ExperimentService;
        yield* svc.createExperiment("target", { a: 1 });
        yield* svc.createExperiment("other", { b: 2 });
        yield* svc.createExperiment("target", { c: 3 });
        return yield* svc.listExperiments("target");
      }),
    );
    expect(filtered.length).toBe(2);
    expect(filtered.every((e) => e.templateId === "target")).toBe(true);
  });

  test("returns empty for templateId with no experiments", async () => {
    const filtered = await runWithService(
      Effect.gen(function* () {
        const svc = yield* ExperimentService;
        yield* svc.createExperiment("other", { a: 1 });
        return yield* svc.listExperiments("nonexistent");
      }),
    );
    expect(filtered.length).toBe(0);
  });
});
