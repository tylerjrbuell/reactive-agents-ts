import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import {
  InteractionManager,
  InteractionManagerLive,
} from "../src/services/interaction-manager.js";
import { ModeSwitcherLive } from "../src/services/mode-switcher.js";
import { NotificationServiceLive } from "../src/services/notification-service.js";
import { CheckpointServiceLive } from "../src/services/checkpoint-service.js";
import { CollaborationServiceLive } from "../src/services/collaboration-service.js";
import { PreferenceLearnerLive } from "../src/services/preference-learner.js";
import { EventBus } from "@reactive-agents/core";
import type { AgentEvent } from "@reactive-agents/core";
import { defaultInteractionConfig } from "../src/types/config.js";

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

const SwitcherLayer = ModeSwitcherLive(defaultInteractionConfig).pipe(
  Layer.provide(MockEventBus),
);
const NotificationLayer = NotificationServiceLive.pipe(Layer.provide(MockEventBus));
const CheckpointLayer = CheckpointServiceLive.pipe(Layer.provide(MockEventBus));
const CollaborationLayer = CollaborationServiceLive.pipe(Layer.provide(MockEventBus));

const LeafLayers = Layer.mergeAll(
  SwitcherLayer,
  NotificationLayer,
  CheckpointLayer,
  CollaborationLayer,
  PreferenceLearnerLive,
  MockEventBus,
);

const TestLayer = InteractionManagerLive.pipe(Layer.provide(LeafLayers));

describe("InteractionManager", () => {
  it("should get mode as autonomous by default", async () => {
    const program = Effect.gen(function* () {
      const manager = yield* InteractionManager;
      const mode = yield* manager.getMode("agent-1");
      expect(mode).toBe("autonomous");
    });

    await Effect.runPromise(program.pipe(Effect.provide(TestLayer)));
  });

  it("should switch mode and publish event", async () => {
    publishedEvents.length = 0;

    const program = Effect.gen(function* () {
      const manager = yield* InteractionManager;
      yield* manager.switchMode("agent-1", "supervised");
      const mode = yield* manager.getMode("agent-1");
      expect(mode).toBe("supervised");
    });

    await Effect.runPromise(program.pipe(Effect.provide(TestLayer)));

    const modeChangedEvents = publishedEvents.filter(
      (e: any) => e._tag === "Custom" && e.type === "interaction.mode-changed",
    );
    expect(modeChangedEvents.length).toBeGreaterThanOrEqual(1);
  });

  it("should send notification through manager", async () => {
    const program = Effect.gen(function* () {
      const manager = yield* InteractionManager;

      const notification = yield* manager.notify({
        agentId: "agent-1",
        channel: "event-bus",
        priority: "normal",
        title: "Task complete",
        body: "Agent has finished processing",
      });

      expect(notification.id).toBeDefined();
      expect(notification.title).toBe("Task complete");
      expect(notification.agentId).toBe("agent-1");
    });

    await Effect.runPromise(program.pipe(Effect.provide(TestLayer)));
  });

  it("should list unread notifications via manager", async () => {
    const program = Effect.gen(function* () {
      const manager = yield* InteractionManager;

      yield* manager.notify({
        agentId: "agent-1",
        channel: "in-app",
        priority: "high",
        title: "Alert",
        body: "Something happened",
      });

      const unread = yield* manager.listUnread();
      expect(unread.length).toBeGreaterThanOrEqual(1);
    });

    await Effect.runPromise(program.pipe(Effect.provide(TestLayer)));
  });

  it("should mark notification as read via manager", async () => {
    const program = Effect.gen(function* () {
      const manager = yield* InteractionManager;

      const notification = yield* manager.notify({
        agentId: "agent-1",
        channel: "in-app",
        priority: "normal",
        title: "Read me",
        body: "I should be marked read",
      });

      yield* manager.markRead(notification.id);

      const unread = yield* manager.listUnread();
      const found = unread.find((n) => n.id === notification.id);
      expect(found).toBeUndefined();
    });

    await Effect.runPromise(program.pipe(Effect.provide(TestLayer)));
  });
});
