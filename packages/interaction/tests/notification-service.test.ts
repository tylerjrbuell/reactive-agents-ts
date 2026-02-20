// File: tests/notification-service.test.ts
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import {
  NotificationService,
  NotificationServiceLive,
} from "../src/services/notification-service.js";
import { EventBus } from "@reactive-agents/core";
import type { AgentEvent } from "@reactive-agents/core";

// ─── Mock EventBus ───
const publishedEvents: unknown[] = [];

const MockEventBus = Layer.succeed(EventBus, {
  publish: (event: AgentEvent) =>
    Effect.sync(() => {
      publishedEvents.push(event);
    }),
  subscribe: () => Effect.succeed(() => {}),
  on: () => Effect.succeed(() => {}),
} as any);

const TestLayer = NotificationServiceLive.pipe(Layer.provide(MockEventBus));

describe("NotificationService", () => {
  it("should send a notification and store it", async () => {
    const program = Effect.gen(function* () {
      const svc = yield* NotificationService;

      const notification = yield* svc.send({
        agentId: "agent-1",
        channel: "event-bus",
        priority: "normal",
        title: "Test Notification",
        body: "Hello from interaction layer",
      });

      expect(notification.id).toBeDefined();
      expect(notification.agentId).toBe("agent-1");
      expect(notification.channel).toBe("event-bus");
      expect(notification.priority).toBe("normal");
      expect(notification.title).toBe("Test Notification");
      expect(notification.body).toBe("Hello from interaction layer");
      expect(notification.readAt).toBeUndefined();
      expect(notification.createdAt).toBeInstanceOf(Date);
    });

    await Effect.runPromise(program.pipe(Effect.provide(TestLayer)));
  });

  it("should list unread notifications", async () => {
    const program = Effect.gen(function* () {
      const svc = yield* NotificationService;

      yield* svc.send({
        agentId: "agent-1",
        channel: "in-app",
        priority: "high",
        title: "Alert 1",
        body: "First alert",
      });

      yield* svc.send({
        agentId: "agent-1",
        channel: "in-app",
        priority: "low",
        title: "Alert 2",
        body: "Second alert",
      });

      const unread = yield* svc.listUnread();
      expect(unread.length).toBe(2);
    });

    await Effect.runPromise(program.pipe(Effect.provide(TestLayer)));
  });

  it("should mark a notification as read", async () => {
    const program = Effect.gen(function* () {
      const svc = yield* NotificationService;

      const notification = yield* svc.send({
        agentId: "agent-1",
        channel: "event-bus",
        priority: "normal",
        title: "Mark me read",
        body: "Should be read",
      });

      yield* svc.markRead(notification.id);

      const unread = yield* svc.listUnread();
      expect(unread.length).toBe(0);
    });

    await Effect.runPromise(program.pipe(Effect.provide(TestLayer)));
  });

  it("should publish event via EventBus on send", async () => {
    publishedEvents.length = 0;

    const program = Effect.gen(function* () {
      const svc = yield* NotificationService;

      yield* svc.send({
        agentId: "agent-1",
        channel: "event-bus",
        priority: "urgent",
        title: "Urgent",
        body: "Urgent notification",
      });
    });

    await Effect.runPromise(program.pipe(Effect.provide(TestLayer)));

    const customEvents = publishedEvents.filter(
      (e: any) => e._tag === "Custom" && e.type === "interaction.notification",
    );
    expect(customEvents.length).toBeGreaterThanOrEqual(1);
  });
});
