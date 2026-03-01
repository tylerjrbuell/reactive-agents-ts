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
});
