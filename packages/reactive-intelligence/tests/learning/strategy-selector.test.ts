import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { BanditStore } from "../../src/learning/bandit-store.js";
import { updateArm } from "../../src/learning/bandit.js";
import {
  StrategySelectorService,
  StrategySelectorServiceLive,
  deriveContextBucket,
} from "../../src/learning/strategy-selector.js";
import { classifyTaskCategory } from "../../src/learning/task-classifier.js";

describe("StrategySelectorServiceLive — read reflects write", () => {
  test("deriveContextBucket matches the write-side format used by learning-engine.ts", () => {
    const selCtx = { taskDescription: "fix the bug in the parser", modelId: "claude-sonnet-4" };
    const taskCategory = classifyTaskCategory(selCtx.taskDescription);
    // Write-side format (learning-engine.ts:126): `${data.modelId}:${taskCategory}`
    expect(deriveContextBucket(selCtx)).toBe(`claude-sonnet-4:${taskCategory}`);
  });

  test("select() favors the strategy with bandit history seeded via updateArm (the actual write path)", () => {
    const store = new BanditStore(":memory:");
    const armIds = ["reactive", "plan-execute-reflect", "tree-of-thought"];
    const modelId = "claude-sonnet-4";
    const taskDescription = "implement a new caching layer for the service";
    const taskCategory = classifyTaskCategory(taskDescription);
    const contextBucket = `${modelId}:${taskCategory}`;

    // Seed heavy success history for "plan-execute-reflect" via the SAME
    // updateArm write path learning-engine.ts uses on every completed run,
    // and heavy failure history for the other two arms — well past the
    // cold-start threshold (5 pulls) so Thompson sampling is in the
    // posterior-sampling regime, not uniform-random cold start.
    for (let i = 0; i < 40; i++) {
      updateArm(contextBucket, "plan-execute-reflect", 1.0, store); // reward>0.5 -> alpha++
      updateArm(contextBucket, "reactive", 0.0, store); // reward<=0.5 -> beta++
      updateArm(contextBucket, "tree-of-thought", 0.0, store);
    }

    const layer = StrategySelectorServiceLive(armIds, store);

    const selections: string[] = [];
    for (let i = 0; i < 30; i++) {
      const strategy = Effect.runSync(
        Effect.gen(function* () {
          const svc = yield* StrategySelectorService;
          return yield* svc.select({ taskDescription, modelId }, {});
        }).pipe(Effect.provide(layer)),
      );
      selections.push(strategy);
    }

    const favoredCount = selections.filter((s) => s === "plan-execute-reflect").length;
    // Thompson sampling is stochastic, but with alpha=41 for the favored
    // arm vs beta=41 for the other two failing arms, the favored arm should
    // win the overwhelming majority of draws — well above the 1/3 chance
    // baseline a broken (or never-called) selector would produce.
    expect(favoredCount).toBeGreaterThan(15);
  });

  test("select() falls back to uniform-random cold start when no bandit history exists (armIds still respected)", () => {
    const store = new BanditStore(":memory:");
    const armIds = ["reactive", "plan-execute-reflect", "tree-of-thought"];
    const layer = StrategySelectorServiceLive(armIds, store);

    const strategy = Effect.runSync(
      Effect.gen(function* () {
        const svc = yield* StrategySelectorService;
        return yield* svc.select({ taskDescription: "quick lookup task", modelId: "m1" }, {});
      }).pipe(Effect.provide(layer)),
    );
    expect(armIds).toContain(strategy);
  });
});
