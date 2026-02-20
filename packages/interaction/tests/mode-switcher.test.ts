// File: tests/mode-switcher.test.ts
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import {
  ModeSwitcher,
  ModeSwitcherLive,
} from "../src/services/mode-switcher.js";
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

const TestLayer = ModeSwitcherLive(defaultInteractionConfig).pipe(
  Layer.provide(MockEventBus),
);

describe("ModeSwitcher", () => {
  it("should return autonomous as default mode for unknown agent", async () => {
    const program = Effect.gen(function* () {
      const switcher = yield* ModeSwitcher;
      const mode = yield* switcher.getMode("agent-1");
      expect(mode).toBe("autonomous");
    });

    await Effect.runPromise(program.pipe(Effect.provide(TestLayer)));
  });

  it("should switch mode manually", async () => {
    const program = Effect.gen(function* () {
      const switcher = yield* ModeSwitcher;
      yield* switcher.setMode("agent-2", "supervised");
      const mode = yield* switcher.getMode("agent-2");
      expect(mode).toBe("supervised");
    });

    await Effect.runPromise(program.pipe(Effect.provide(TestLayer)));
  });

  it("should not change mode when setting same mode", async () => {
    publishedEvents.length = 0;

    const program = Effect.gen(function* () {
      const switcher = yield* ModeSwitcher;
      // Default is autonomous; setting autonomous again should be a no-op
      yield* switcher.setMode("agent-3", "autonomous");
      const mode = yield* switcher.getMode("agent-3");
      expect(mode).toBe("autonomous");
    });

    await Effect.runPromise(program.pipe(Effect.provide(TestLayer)));

    // No mode-changed event should have been published for same-mode set
    const modeChangedEvents = publishedEvents.filter(
      (e: any) => e._tag === "Custom" && e.type === "interaction.mode-changed",
    );
    expect(modeChangedEvents.length).toBe(0);
  });

  it("should publish mode-changed event on switch", async () => {
    publishedEvents.length = 0;

    const program = Effect.gen(function* () {
      const switcher = yield* ModeSwitcher;
      yield* switcher.setMode("agent-4", "collaborative");
    });

    await Effect.runPromise(program.pipe(Effect.provide(TestLayer)));

    const modeChangedEvents = publishedEvents.filter(
      (e: any) => e._tag === "Custom" && e.type === "interaction.mode-changed",
    );
    expect(modeChangedEvents.length).toBe(1);
    expect((modeChangedEvents[0] as any).payload).toEqual({
      agentId: "agent-4",
      from: "autonomous",
      to: "collaborative",
    });
  });
});
