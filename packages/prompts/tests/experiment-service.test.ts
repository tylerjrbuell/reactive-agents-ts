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

describe("ExperimentService", () => {
  test("creates an experiment with equal split by default", async () => {
    const exp = await runWithService(
      Effect.gen(function* () {
        const svc = yield* ExperimentService;
        return yield* svc.createExperiment("reasoning.react", {
          control: 1,
          variant_a: 2,
        });
      }),
    );

    expect(exp.id).toStartWith("exp-");
    expect(exp.templateId).toBe("reasoning.react");
    expect(exp.variants.get("control")).toBe(1);
    expect(exp.variants.get("variant_a")).toBe(2);
    expect(exp.status).toBe("active");
    // Default equal split
    expect(exp.splitRatio.get("control")).toBe(0.5);
    expect(exp.splitRatio.get("variant_a")).toBe(0.5);
  });

  test("creates experiment with custom split ratio", async () => {
    const exp = await runWithService(
      Effect.gen(function* () {
        const svc = yield* ExperimentService;
        return yield* svc.createExperiment(
          "reasoning.react",
          { control: 1, variant_a: 2 },
          { control: 0.8, variant_a: 0.2 },
        );
      }),
    );

    expect(exp.splitRatio.get("control")).toBe(0.8);
    expect(exp.splitRatio.get("variant_a")).toBe(0.2);
  });

  test("assigns variants deterministically", async () => {
    const results = await runWithService(
      Effect.gen(function* () {
        const svc = yield* ExperimentService;
        const exp = yield* svc.createExperiment("test-template", {
          control: 1,
          variant_a: 2,
        });

        // Same user, same experiment → same assignment
        const a1 = yield* svc.assignVariant(exp.id, "user-123");
        const a2 = yield* svc.assignVariant(exp.id, "user-123");

        // Different user → potentially different assignment
        const b1 = yield* svc.assignVariant(exp.id, "user-456");

        return { a1, a2, b1 };
      }),
    );

    expect(results.a1).not.toBeNull();
    expect(results.a1!.variant).toBe(results.a2!.variant); // Sticky
    expect(results.a1!.version).toBe(results.a2!.version);
    expect(results.b1).not.toBeNull();
    expect(["control", "variant_a"]).toContain(results.b1!.variant);
  });

  test("returns null for paused experiment", async () => {
    const result = await runWithService(
      Effect.gen(function* () {
        const svc = yield* ExperimentService;
        const exp = yield* svc.createExperiment("test", { a: 1, b: 2 });
        yield* svc.updateStatus(exp.id, "paused");
        return yield* svc.assignVariant(exp.id, "user-1");
      }),
    );

    expect(result).toBeNull();
  });

  test("records outcomes and computes results", async () => {
    const results = await runWithService(
      Effect.gen(function* () {
        const svc = yield* ExperimentService;
        const exp = yield* svc.createExperiment("test", { a: 1, b: 2 });

        // Assign and record outcomes for many users
        for (let i = 0; i < 20; i++) {
          const userId = `user-${i}`;
          const assignment = yield* svc.assignVariant(exp.id, userId);
          if (assignment) {
            yield* svc.recordOutcome(exp.id, assignment.variant, userId, {
              success: assignment.variant === "a" ? i % 2 === 0 : true,
              score: assignment.variant === "a" ? 0.6 : 0.9,
            });
          }
        }

        return yield* svc.getExperimentResults(exp.id);
      }),
    );

    expect(results).not.toBeNull();
    expect(results!.experimentId).toStartWith("exp-");
    expect(results!.totalAssignments).toBe(20);
    expect(results!.totalOutcomes).toBe(20);
    expect(results!.variants["a"]).toBeDefined();
    expect(results!.variants["b"]).toBeDefined();
  });

  test("returns null results for unknown experiment", async () => {
    const result = await runWithService(
      Effect.gen(function* () {
        const svc = yield* ExperimentService;
        return yield* svc.getExperimentResults("unknown-id");
      }),
    );

    expect(result).toBeNull();
  });

  test("lists experiments filtered by templateId", async () => {
    const { all, filtered } = await runWithService(
      Effect.gen(function* () {
        const svc = yield* ExperimentService;
        yield* svc.createExperiment("template-a", { v1: 1, v2: 2 });
        yield* svc.createExperiment("template-b", { v1: 1, v2: 2 });
        yield* svc.createExperiment("template-a", { v3: 3, v4: 4 });

        const all = yield* svc.listExperiments();
        const filtered = yield* svc.listExperiments("template-a");
        return { all, filtered };
      }),
    );

    expect(all.length).toBe(3);
    expect(filtered.length).toBe(2);
    expect(filtered.every((e) => e.templateId === "template-a")).toBe(true);
  });

  test("variant distribution is roughly balanced for equal split", async () => {
    const counts = await runWithService(
      Effect.gen(function* () {
        const svc = yield* ExperimentService;
        const exp = yield* svc.createExperiment("test", { a: 1, b: 2 });

        const variantCounts: Record<string, number> = { a: 0, b: 0 };
        for (let i = 0; i < 100; i++) {
          const assignment = yield* svc.assignVariant(exp.id, `user-dist-${i}`);
          if (assignment) variantCounts[assignment.variant]!++;
        }
        return variantCounts;
      }),
    );

    // With 100 users and equal split, each should get roughly 50 (±20)
    expect(counts.a).toBeGreaterThan(20);
    expect(counts.b).toBeGreaterThan(20);
    expect(counts.a + counts.b).toBe(100);
  });

  test("winner requires minimum 5 outcomes per variant", async () => {
    const results = await runWithService(
      Effect.gen(function* () {
        const svc = yield* ExperimentService;
        const exp = yield* svc.createExperiment("test", { a: 1, b: 2 });

        // Only record 3 outcomes — not enough for a winner
        for (let i = 0; i < 3; i++) {
          yield* svc.assignVariant(exp.id, `user-${i}`);
          yield* svc.recordOutcome(exp.id, "a", `user-${i}`, {
            success: true,
            score: 1.0,
          });
        }

        return yield* svc.getExperimentResults(exp.id);
      }),
    );

    expect(results!.winner).toBeNull(); // Not enough data
  });
});
