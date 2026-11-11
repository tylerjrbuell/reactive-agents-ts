import { describe, test, expect, afterEach } from "bun:test";
import { Effect, Layer } from "effect";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Database } from "@reactive-agents/runtime-shim";
import { EventBusLive } from "@reactive-agents/core";
import {
  BanditStore,
  readBanditArmStats,
  splitContextBucket,
} from "../../src/learning/bandit-store.js";
import { LearningEngineService } from "../../src/learning/learning-engine.js";
import { createReactiveIntelligenceLayer } from "../../src/runtime.js";

const dirs: string[] = [];
const tempDb = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "ri-bandit-"));
  dirs.push(dir);
  return join(dir, "nested", "calibration.db");
};

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("BanditStore persistence", () => {
  test("arm stats survive closing and reopening the store", () => {
    const path = tempDb();
    const first = new BanditStore(path);
    first.save({ contextBucket: "qwen3:14b:coding", armId: "react", alpha: 4, beta: 2, pulls: 5 });
    first.close();

    const reopened = new BanditStore(path);
    expect(reopened.load("qwen3:14b:coding", "react")).toEqual({
      contextBucket: "qwen3:14b:coding",
      armId: "react",
      alpha: 4,
      beta: 2,
      pulls: 5,
    });
    reopened.close();
  });

  test("in-memory stores do not share state", () => {
    const a = new BanditStore();
    a.save({ contextBucket: "m:general", armId: "react", alpha: 2, beta: 1, pulls: 1 });
    const b = new BanditStore();
    expect(b.load("m:general", "react")).toBeNull();
    expect(readBanditArmStats(":memory:")).toEqual([]);
  });

  test("listArmStats splits buckets at the last colon, filters and orders", () => {
    const store = new BanditStore();
    store.save({ contextBucket: "qwen3:14b:coding", armId: "react", alpha: 3, beta: 1, pulls: 2 });
    store.save({ contextBucket: "qwen3:14b:coding", armId: "plan-execute", alpha: 1, beta: 1, pulls: 5 });
    store.save({ contextBucket: "gpt-4o:research", armId: "react", alpha: 1, beta: 3, pulls: 2 });

    const all = store.listArmStats();
    expect(all.map((v) => [v.modelId, v.taskCategory, v.armId])).toEqual([
      ["gpt-4o", "research", "react"],
      ["qwen3:14b", "coding", "plan-execute"],
      ["qwen3:14b", "coding", "react"],
    ]);
    const react = all.find((v) => v.modelId === "qwen3:14b" && v.armId === "react");
    expect(react?.meanReward).toBe(0.75);
    expect(Number.isNaN(Date.parse(react?.updatedAt ?? ""))).toBe(false);

    expect(store.listArmStats({ modelId: "gpt-4o" })).toHaveLength(1);
    expect(store.listArmStats({ taskCategory: "coding" })).toHaveLength(2);
    expect(splitContextBucket("nocolon")).toEqual({ modelId: "nocolon", taskCategory: "" });
  });

  test("readBanditArmStats reads a persisted file without holding it open", () => {
    const path = tempDb();
    const store = new BanditStore(path);
    store.save({ contextBucket: "m:general", armId: "react", alpha: 2, beta: 2, pulls: 2 });
    store.close();
    const stats = readBanditArmStats(path, { modelId: "m" });
    expect(stats).toHaveLength(1);
    expect(stats[0]?.meanReward).toBe(0.5);
  });

  test("readBanditArmStats on a missing DB returns empty and creates nothing", () => {
    const path = tempDb();
    expect(readBanditArmStats(path)).toEqual([]);
    expect(existsSync(path)).toBe(false);
    expect(existsSync(dirname(path))).toBe(false);
  });

  test("readBanditArmStats on a DB without the bandit table returns empty and writes nothing", () => {
    const path = tempDb();
    mkdirSync(dirname(path), { recursive: true });
    const other = new Database(path, { create: true });
    other.exec("CREATE TABLE calibration (model_id TEXT)");
    other.close();
    const before = readFileSync(path);
    expect(readBanditArmStats(path)).toEqual([]);
    expect(readFileSync(path).equals(before)).toBe(true);
    expect(readdirSync(dirname(path))).toEqual(["calibration.db"]);
  });

  test("readBanditArmStats leaves a persisted DB byte-identical", () => {
    const path = tempDb();
    const store = new BanditStore(path);
    store.save({ contextBucket: "m:general", armId: "react", alpha: 3, beta: 1, pulls: 2 });
    store.close();
    const files = readdirSync(dirname(path)).sort();
    const before = readFileSync(path);
    expect(readBanditArmStats(path)).toHaveLength(1);
    expect(readFileSync(path).equals(before)).toBe(true);
    expect(readdirSync(dirname(path)).sort()).toEqual(files);
  });

  test("createReactiveIntelligenceLayer persists bandit learning to calibrationDbPath", async () => {
    const path = tempDb();
    const layer = createReactiveIntelligenceLayer({ calibrationDbPath: path }).pipe(
      Layer.provide(EventBusLive),
    ) as Layer.Layer<LearningEngineService>;
    await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const svc = yield* LearningEngineService;
          yield* svc.onRunCompleted({
            modelId: "claude-3.5",
            provider: "anthropic",
            taskDescription: "write a function to sort an array",
            strategy: "react",
            outcome: "success",
            entropyHistory: [{ composite: 0.2, trajectory: { shape: "converging" } }],
            totalTokens: 100,
            durationMs: 10,
            temperature: 0.7,
            maxIterations: 5,
          });
        }),
        layer,
      ),
    );
    const stats = readBanditArmStats(path, { modelId: "claude-3.5" });
    expect(stats).toHaveLength(1);
    expect(stats[0]?.armId).toBe("react");
    expect(stats[0]?.pulls).toBe(1);
  });
});
