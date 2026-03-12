import { describe, expect, it, afterEach } from "bun:test";
import { Effect, Layer } from "effect";
import { DebriefStoreService, DebriefStoreLive } from "../src/services/debrief-store.js";
import type { AgentDebriefShape } from "../src/services/debrief-store.js";
import { MemoryDatabaseLive } from "../src/database.js";
import { defaultMemoryConfig } from "../src/types.js";
import * as fs from "node:fs";
import * as path from "node:path";

const TEST_DB_DIR = "/tmp/test-debrief-store";
const TEST_DB = path.join(TEST_DB_DIR, "test.db");

const makeLayer = () =>
  DebriefStoreLive.pipe(
    Layer.provide(
      MemoryDatabaseLive({ ...defaultMemoryConfig("test-agent"), dbPath: TEST_DB }),
    ),
  );

const sampleDebrief: AgentDebriefShape = {
  outcome: "success",
  summary: "Fetched commits and sent message",
  keyFindings: ["5 commits retrieved"],
  errorsEncountered: [],
  lessonsLearned: ["github/list_commits is reliable"],
  confidence: "high",
  toolsUsed: [{ name: "github/list_commits", calls: 1, successRate: 1 }],
  metrics: { tokens: 5000, duration: 12000, iterations: 5, cost: 0 },
  markdown: "# Debrief\n\nDone.",
};

afterEach(() => {
  try { fs.unlinkSync(TEST_DB); } catch {}
  try { fs.unlinkSync(TEST_DB + "-wal"); } catch {}
  try { fs.unlinkSync(TEST_DB + "-shm"); } catch {}
  try { fs.rmSync(TEST_DB_DIR, { recursive: true }); } catch {}
});

describe("DebriefStore", () => {
  it("saves and retrieves a debrief by taskId", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* DebriefStoreService;
        yield* store.save({
          taskId: "task-abc",
          agentId: "agent-1",
          taskPrompt: "Fetch commits",
          terminatedBy: "final_answer_tool",
          output: "done",
          outputFormat: "text",
          debrief: sampleDebrief,
        });
        return yield* store.findByTaskId("task-abc");
      }).pipe(Effect.provide(makeLayer()))
    );

    expect(result).not.toBeNull();
    expect(result?.taskId).toBe("task-abc");
    expect(result?.debrief.outcome).toBe("success");
    expect(result?.debrief.summary).toContain("commits");
    expect(result?.createdAt).toBeGreaterThan(0);
  });

  it("returns null for unknown taskId", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* DebriefStoreService;
        return yield* store.findByTaskId("nonexistent");
      }).pipe(Effect.provide(makeLayer()))
    );
    expect(result).toBeNull();
  });

  it("lists recent debriefs for an agent", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* DebriefStoreService;
        yield* store.save({ taskId: "t1", agentId: "agent-1", taskPrompt: "task 1", terminatedBy: "final_answer_tool", output: "a", outputFormat: "text", debrief: sampleDebrief });
        yield* store.save({ taskId: "t2", agentId: "agent-1", taskPrompt: "task 2", terminatedBy: "final_answer_tool", output: "b", outputFormat: "text", debrief: sampleDebrief });
        yield* store.save({ taskId: "t3", agentId: "agent-2", taskPrompt: "task 3", terminatedBy: "max_iterations", output: "c", outputFormat: "text", debrief: { ...sampleDebrief, outcome: "partial" } });
      }).pipe(Effect.provide(makeLayer()))
    );

    const results = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* DebriefStoreService;
        return yield* store.listByAgent("agent-1", 10);
      }).pipe(Effect.provide(makeLayer()))
    );

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.agentId === "agent-1")).toBe(true);
  });

  it("listByAgent respects the limit parameter", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* DebriefStoreService;
        yield* store.save({ taskId: "lim-1", agentId: "agent-limit", taskPrompt: "task 1", terminatedBy: "final_answer_tool", output: "a", outputFormat: "text", debrief: sampleDebrief });
        yield* store.save({ taskId: "lim-2", agentId: "agent-limit", taskPrompt: "task 2", terminatedBy: "final_answer_tool", output: "b", outputFormat: "text", debrief: sampleDebrief });
        yield* store.save({ taskId: "lim-3", agentId: "agent-limit", taskPrompt: "task 3", terminatedBy: "final_answer_tool", output: "c", outputFormat: "text", debrief: sampleDebrief });
      }).pipe(Effect.provide(makeLayer()))
    );

    const results = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* DebriefStoreService;
        return yield* store.listByAgent("agent-limit", 2);
      }).pipe(Effect.provide(makeLayer()))
    );

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.agentId === "agent-limit")).toBe(true);
  });
});
