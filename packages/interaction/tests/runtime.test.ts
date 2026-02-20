// File: tests/runtime.test.ts
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { createInteractionLayer } from "../src/runtime.js";
import { InteractionManager } from "../src/services/interaction-manager.js";
import { ModeSwitcher } from "../src/services/mode-switcher.js";
import { NotificationService } from "../src/services/notification-service.js";
import { EventBus } from "@reactive-agents/core";

// ─── Mock EventBus ───
const MockEventBus = Layer.succeed(EventBus, {
  publish: () => Effect.void,
  subscribe: () => Effect.succeed(() => {}),
  on: () => Effect.succeed(() => {}),
} as any);

const InteractionLive = createInteractionLayer().pipe(
  Layer.provide(MockEventBus),
);

describe("createInteractionLayer", () => {
  it("should provide InteractionManager", async () => {
    const program = Effect.gen(function* () {
      const manager = yield* InteractionManager;
      const mode = yield* manager.getMode("test-agent");
      expect(mode).toBe("autonomous");
    });

    await Effect.runPromise(program.pipe(Effect.provide(InteractionLive)));
  });

  it("should provide ModeSwitcher", async () => {
    const program = Effect.gen(function* () {
      const switcher = yield* ModeSwitcher;
      const mode = yield* switcher.getMode("test-agent");
      expect(mode).toBe("autonomous");
    });

    await Effect.runPromise(program.pipe(Effect.provide(InteractionLive)));
  });

  it("should provide NotificationService", async () => {
    const program = Effect.gen(function* () {
      const notifications = yield* NotificationService;
      const unread = yield* notifications.listUnread();
      expect(unread).toEqual([]);
    });

    await Effect.runPromise(program.pipe(Effect.provide(InteractionLive)));
  });

  it("should work with custom config", async () => {
    const customLayer = createInteractionLayer({
      defaultMode: "supervised",
      interruptRules: [],
      reporting: {
        frequency: "realtime",
        channel: "in-app",
        detail: "detailed",
        streaming: true,
      },
      escalationRules: [],
      deescalationRules: [],
      learningEnabled: false,
    }).pipe(Layer.provide(MockEventBus));

    const program = Effect.gen(function* () {
      const manager = yield* InteractionManager;
      const mode = yield* manager.getMode("test-agent");
      expect(mode).toBe("supervised");
    });

    await Effect.runPromise(program.pipe(Effect.provide(customLayer)));
  });
});
