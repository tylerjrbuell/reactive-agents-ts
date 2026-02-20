import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { ModeSwitcher, ModeSwitcherLive, defaultInteractionConfig } from "../src/index.js";
import { EventBusLive } from "@reactive-agents/core";

const TestLayer = ModeSwitcherLive(defaultInteractionConfig).pipe(
  Layer.provide(EventBusLive),
);

const run = <A, E>(effect: Effect.Effect<A, E, ModeSwitcher>) =>
  effect.pipe(Effect.provide(TestLayer), Effect.runPromise);

describe("Mode Transition (Escalation/De-escalation)", () => {
  it("should escalate from autonomous to supervised on low confidence", async () => {
    const result = await run(
      Effect.gen(function* () {
        const svc = yield* ModeSwitcher;
        return yield* svc.evaluateTransition("agent-1", { confidence: 0.2 });
      }),
    );
    expect(result).toBe("supervised");
  });

  it("should not escalate when confidence is high", async () => {
    const result = await run(
      Effect.gen(function* () {
        const svc = yield* ModeSwitcher;
        return yield* svc.evaluateTransition("agent-1", { confidence: 0.8 });
      }),
    );
    expect(result).toBeNull();
  });

  it("should de-escalate from collaborative to autonomous on high confidence + approvals", async () => {
    const result = await run(
      Effect.gen(function* () {
        const svc = yield* ModeSwitcher;
        yield* svc.setMode("agent-1", "collaborative");
        return yield* svc.evaluateTransition("agent-1", {
          confidence: 0.95,
          consecutiveApprovals: 5,
        });
      }),
    );
    expect(result).toBe("autonomous");
  });

  it("should not de-escalate without sufficient approvals", async () => {
    const result = await run(
      Effect.gen(function* () {
        const svc = yield* ModeSwitcher;
        yield* svc.setMode("agent-1", "collaborative");
        return yield* svc.evaluateTransition("agent-1", {
          confidence: 0.95,
          consecutiveApprovals: 1,
        });
      }),
    );
    expect(result).toBeNull();
  });
});
