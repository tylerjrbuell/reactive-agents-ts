import { describe, it, expect, afterEach } from "bun:test";
import { Effect, Layer } from "effect";
import { EventBus, EventBusLive, type AgentEvent } from "@reactive-agents/core";
import { MemoryService, createMemoryLayer } from "../src/index.js";
import type { SemanticEntry, DailyLogEntry, MemoryId } from "../src/types.js";
import {
  buildBootstrapRecallEvents,
  MEMORY_RECALLED_MAX_ITEMS,
  MEMORY_RECALLED_MAX_SUMMARY,
} from "../src/services/recall-event.js";
import * as fs from "node:fs";

const DB_DIR = "/tmp/test-memory-recalled-db";
const DB = `${DB_DIR}/recalled.db`;

const semantic = (n: number, content = `fact ${n}`): SemanticEntry => ({
  id: `sem-${n}` as MemoryId,
  agentId: "a1",
  content,
  summary: content,
  importance: 0.5,
  verified: false,
  tags: [],
  createdAt: new Date(),
  updatedAt: new Date(),
  accessCount: 0,
  lastAccessedAt: new Date(),
});

const episode = (n: number): DailyLogEntry => ({
  id: `ep-${n}` as MemoryId,
  agentId: "a1",
  date: "2026-11-11",
  content: `episode ${n}`,
  eventType: "observation",
  createdAt: new Date(),
});

describe("MemoryRecalled event (seam)", () => {
  afterEach(() => {
    fs.rmSync(DB_DIR, { recursive: true, force: true });
    fs.rmSync(".reactive-agents", { recursive: true, force: true });
  });

  const runWithBus = async (
    seed: (svc: MemoryService["Type"]) => Effect.Effect<unknown, unknown>,
    taskId: string | undefined,
  ): Promise<AgentEvent[]> => {
    const bus = EventBusLive;
    const layer = createMemoryLayer("1", { agentId: "a1", dbPath: DB }).pipe(
      Layer.provideMerge(bus),
    );
    return Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const eb = yield* EventBus;
          const seen: AgentEvent[] = [];
          yield* eb.on("MemoryRecalled", (e) =>
            Effect.sync(() => void seen.push(e)),
          );
          const svc = yield* MemoryService;
          yield* seed(svc);
          yield* svc.bootstrap("a1", taskId);
          return seen;
        }).pipe(Effect.provide(layer)),
      ),
    );
  };

  it("emits MemoryRecalled per recalled tier with taskId", async () => {
    const seen = await runWithBus(
      (svc) =>
        Effect.gen(function* () {
          yield* svc.storeSemantic(semantic(1, "user prefers tabs"));
          yield* svc.logEpisode(episode(1));
        }),
      "task-1",
    );
    const tiers = seen.map((e) => (e._tag === "MemoryRecalled" ? e.tier : ""));
    expect(tiers.sort()).toEqual(["episodic", "semantic"]);
    const sem = seen.find((e) => e._tag === "MemoryRecalled" && e.tier === "semantic");
    expect(sem?._tag === "MemoryRecalled" && sem.taskId).toBe("task-1");
    expect(sem?._tag === "MemoryRecalled" && sem.agentId).toBe("a1");
    expect(sem?._tag === "MemoryRecalled" && sem.items[0]?.summary).toBe("user prefers tabs");
  });

  it("emits nothing when nothing is recalled", async () => {
    const seen = await runWithBus(() => Effect.void, "task-2");
    expect(seen).toEqual([]);
  });

  it("emits nothing without a taskId", async () => {
    const seen = await runWithBus((svc) => svc.storeSemantic(semantic(1)), undefined);
    expect(seen).toEqual([]);
  });

  it("caps items and truncates summaries", () => {
    const events = buildBootstrapRecallEvents({
      taskId: "t",
      agentId: "a1",
      semantic: Array.from({ length: 30 }, (_, i) => semantic(i, "x".repeat(500))),
      episodes: [],
      workflows: [],
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.items).toHaveLength(MEMORY_RECALLED_MAX_ITEMS);
    expect(events[0]!.items[0]!.summary.length).toBeLessThanOrEqual(MEMORY_RECALLED_MAX_SUMMARY);
  });
});
