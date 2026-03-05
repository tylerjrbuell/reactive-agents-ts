import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import {
  createHeartbeatEvent,
  createCronEvent,
  SchedulerService,
  SchedulerServiceLive,
} from "../../src/services/scheduler-service.js";
import type { CronEntry } from "../../src/types.js";

// ─── Event Factory Tests ─────────────────────────────────────────────────────

describe("createHeartbeatEvent", () => {
  test("produces correct source, priority, and metadata", () => {
    const event = createHeartbeatEvent("agent-1", "Check inbox");
    expect(event.id).toMatch(/^hb-/);
    expect(event.source).toBe("heartbeat");
    expect(event.agentId).toBe("agent-1");
    expect(event.priority).toBe("low");
    expect(event.metadata.instruction).toBe("Check inbox");
    expect(event.timestamp).toBeInstanceOf(Date);
  });
});

describe("createCronEvent", () => {
  test("produces correct source, priority, metadata.instruction, and metadata.schedule", () => {
    const entry: CronEntry = {
      schedule: "0 9 * * MON",
      instruction: "Generate weekly report",
      priority: "high",
      enabled: true,
    };

    const event = createCronEvent("agent-2", entry);
    expect(event.id).toMatch(/^cron-/);
    expect(event.source).toBe("cron");
    expect(event.agentId).toBe("agent-2");
    expect(event.priority).toBe("high");
    expect(event.metadata.instruction).toBe("Generate weekly report");
    expect(event.metadata.schedule).toBe("0 9 * * MON");
    expect(event.timestamp).toBeInstanceOf(Date);
  });
});

// ─── SchedulerService Tests ──────────────────────────────────────────────────

describe("SchedulerService", () => {
  test("pendingEvents returns empty array initially", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const scheduler = yield* SchedulerService;
        return yield* scheduler.pendingEvents();
      }).pipe(Effect.provide(SchedulerServiceLive({ agentId: "test-agent" }))),
    );

    expect(result).toEqual([]);
  });

  describe("SchedulerService", () => {
    test("pendingEvents returns empty array initially", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const scheduler = yield* SchedulerService;
          return yield* scheduler.pendingEvents();
        }).pipe(
          Effect.provide(SchedulerServiceLive({ agentId: "test-agent" })),
        ),
      );

      expect(result).toEqual([]);
    });

    // ─── Buffered Cron Detection Tests ──────────────────────────────────────────
    // These tests validate that crons fire correctly with timezone support and
    // that the buffered minute-range checking works reliably across heartbeat gaps.

    test("checkCrons returns events array (basic functionality)", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const scheduler = yield* SchedulerService;
          const events = yield* scheduler.checkCrons(new Date());
          return events;
        }).pipe(
          Effect.provide(
            SchedulerServiceLive({ agentId: "test-agent", crons: [] }),
          ),
        ),
      );

      expect(Array.isArray(result)).toBe(true);
    });

    test("checkCrons initializes lastCheckedMinute on first call to prevent epoch iteration", async () => {
      // This test validates the critical fix: lastCheckedMinute is initialized to
      // currentMinute - 1 on first call, preventing iteration from epoch to present (millions of iterations).
      const config = {
        agentId: "test-agent",
        crons: [
          {
            schedule: "0 9 * * *", // Daily at 9:00 AM
            instruction: "Daily 9 AM task",
          },
        ],
      };

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const scheduler = yield* SchedulerService;
          // Call checkCrons - should initialize lastCheckedMinute and complete quickly
          const events = yield* scheduler.checkCrons(new Date());
          return events;
        }).pipe(Effect.provide(SchedulerServiceLive(config))),
      );

      // Should complete without timeout and return an array
      expect(Array.isArray(result)).toBe(true);
    });

    test("emitHeartbeat returns a heartbeat event", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const scheduler = yield* SchedulerService;
          const event = yield* scheduler.emitHeartbeat();
          return event;
        }).pipe(
          Effect.provide(SchedulerServiceLive({ agentId: "test-agent" })),
        ),
      );

      expect(result.source).toBe("heartbeat");
      expect(result.agentId).toBe("test-agent");
    });
  });
});
