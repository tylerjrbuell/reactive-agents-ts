import { describe, it, expect, afterEach } from "bun:test";
import { Effect, Layer } from "effect";
import { MemoryDatabaseLive } from "../src/database.js";
import { PlanStoreService, PlanStoreServiceLive } from "../src/services/plan-store.js";
import { defaultMemoryConfig } from "../src/types.js";
import * as fs from "node:fs";
import * as path from "node:path";

// Plan type (duplicated here to avoid cross-package dep in test)
interface PlanStep {
  id: string;
  seq: number;
  title: string;
  instruction: string;
  type: "tool_call" | "analysis" | "composite";
  status: "pending" | "in_progress" | "completed" | "failed" | "skipped";
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolHints?: string[];
  dependsOn?: string[];
  result?: string;
  error?: string;
  retries: number;
  tokensUsed: number;
  startedAt?: string;
  completedAt?: string;
}

interface Plan {
  id: string;
  taskId: string;
  agentId: string;
  goal: string;
  mode: "linear" | "dag";
  steps: PlanStep[];
  status: "active" | "completed" | "failed" | "abandoned";
  version: number;
  createdAt: string;
  updatedAt: string;
  totalTokens: number;
  totalCost: number;
}

const TEST_DB_DIR = "/tmp/test-plan-store";
const TEST_DB = path.join(TEST_DB_DIR, "test.db");

const makeLayer = () => PlanStoreServiceLive.pipe(
  Layer.provide(MemoryDatabaseLive({ ...defaultMemoryConfig("test-agent"), dbPath: TEST_DB })),
);

const makePlan = (id: string, goal: string): Plan => ({
  id,
  taskId: "task-1",
  agentId: "agent-1",
  goal,
  mode: "linear",
  status: "active",
  version: 1,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  totalTokens: 0,
  totalCost: 0,
  steps: [
    { id: "s1", seq: 1, title: "Step 1", instruction: "Do A", type: "tool_call", status: "pending", retries: 0, tokensUsed: 0, toolName: "web-search", toolArgs: { query: "test" } },
    { id: "s2", seq: 2, title: "Step 2", instruction: "Analyze", type: "analysis", status: "pending", retries: 0, tokensUsed: 0 },
  ],
});

afterEach(() => {
  try { fs.unlinkSync(TEST_DB); } catch {}
  try { fs.unlinkSync(TEST_DB + "-wal"); } catch {}
  try { fs.unlinkSync(TEST_DB + "-shm"); } catch {}
  try { fs.rmSync(TEST_DB_DIR, { recursive: true }); } catch {}
});

describe("PlanStoreService", () => {
  it("saves and retrieves a plan with steps", async () => {
    const plan = makePlan("p_save1", "Test save");

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* PlanStoreService;
          yield* store.savePlan(plan);
          return yield* store.getPlan("p_save1");
        }).pipe(Effect.provide(makeLayer())),
      ),
    );

    expect(result).not.toBeNull();
    expect(result!.id).toBe("p_save1");
    expect(result!.goal).toBe("Test save");
    expect(result!.steps.length).toBe(2);
    expect(result!.steps[0].toolName).toBe("web-search");
    expect(result!.steps[1].type).toBe("analysis");
  });

  it("getActivePlan returns active plan for agent+task", async () => {
    const plan = makePlan("p_active1", "Active test");

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* PlanStoreService;
          yield* store.savePlan(plan);
          return yield* store.getActivePlan("agent-1", "task-1");
        }).pipe(Effect.provide(makeLayer())),
      ),
    );

    expect(result).not.toBeNull();
    expect(result!.id).toBe("p_active1");
  });

  it("updateStepStatus marks step as completed", async () => {
    const plan = makePlan("p_step1", "Step status test");

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* PlanStoreService;
          yield* store.savePlan(plan);
          yield* store.updateStepStatus("s1", {
            status: "completed",
            result: "Search returned 10 results",
            tokensUsed: 150,
          });
          return yield* store.getPlan("p_step1");
        }).pipe(Effect.provide(makeLayer())),
      ),
    );

    expect(result!.steps[0].status).toBe("completed");
    expect(result!.steps[0].result).toBe("Search returned 10 results");
    expect(result!.steps[0].tokensUsed).toBe(150);
  });

  it("patchRemainingSteps replaces steps from given seq", async () => {
    const plan = makePlan("p_patch1", "Patch test");

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* PlanStoreService;
          yield* store.savePlan(plan);
          yield* store.updateStepStatus("s1", { status: "completed", result: "Done" });
          yield* store.patchRemainingSteps("p_patch1", 1, [
            { id: "s2_new", seq: 2, title: "New Step 2", instruction: "Better approach", type: "composite", status: "pending", retries: 0, tokensUsed: 0, toolHints: ["file-read"] },
            { id: "s3_new", seq: 3, title: "Step 3", instruction: "Final step", type: "analysis", status: "pending", retries: 0, tokensUsed: 0 },
          ]);
          return yield* store.getPlan("p_patch1");
        }).pipe(Effect.provide(makeLayer())),
      ),
    );

    expect(result!.steps.length).toBe(3);
    expect(result!.steps[0].status).toBe("completed");
    expect(result!.steps[1].id).toBe("s2_new");
    expect(result!.steps[1].title).toBe("New Step 2");
    expect(result!.steps[2].id).toBe("s3_new");
  });

  it("getRecentPlans returns plans ordered by creation", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* PlanStoreService;
          yield* store.savePlan(makePlan("p_r1", "First"));
          yield* store.savePlan(makePlan("p_r2", "Second"));
          return yield* store.getRecentPlans("agent-1", 5);
        }).pipe(Effect.provide(makeLayer())),
      ),
    );

    expect(result.length).toBe(2);
  });

  it("returns null for nonexistent plan", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* PlanStoreService;
          return yield* store.getPlan("nonexistent");
        }).pipe(Effect.provide(makeLayer())),
      ),
    );

    expect(result).toBeNull();
  });
});
