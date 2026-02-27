import { describe, test, expect } from "bun:test";
import { Effect, Fiber } from "effect";
import { KillSwitchServiceLive, KillSwitchService } from "../src/kill-switch.js";

const run = <A>(effect: Effect.Effect<A, any, KillSwitchService>) =>
  Effect.runPromise(Effect.provide(effect, KillSwitchServiceLive()));

describe("KillSwitchService", () => {
  test("initially not triggered", async () => {
    const result = await run(
      Effect.gen(function* () {
        const ks = yield* KillSwitchService;
        return yield* ks.isTriggered("agent-1");
      }),
    );
    expect(result.triggered).toBe(false);
    expect(result.reason).toBeUndefined();
  });

  test("trigger and check for specific agent", async () => {
    const result = await run(
      Effect.gen(function* () {
        const ks = yield* KillSwitchService;
        yield* ks.trigger("agent-1", "safety concern");
        return yield* ks.isTriggered("agent-1");
      }),
    );
    expect(result.triggered).toBe(true);
    expect(result.reason).toBe("safety concern");
  });

  test("does not affect other agents", async () => {
    const result = await run(
      Effect.gen(function* () {
        const ks = yield* KillSwitchService;
        yield* ks.trigger("agent-1", "safety concern");
        return yield* ks.isTriggered("agent-2");
      }),
    );
    expect(result.triggered).toBe(false);
  });

  test("clear re-enables agent", async () => {
    const result = await run(
      Effect.gen(function* () {
        const ks = yield* KillSwitchService;
        yield* ks.trigger("agent-1", "test");
        yield* ks.clear("agent-1");
        return yield* ks.isTriggered("agent-1");
      }),
    );
    expect(result.triggered).toBe(false);
  });

  test("global kill switch affects all agents", async () => {
    const result = await run(
      Effect.gen(function* () {
        const ks = yield* KillSwitchService;
        yield* ks.triggerGlobal("system shutdown");
        const r1 = yield* ks.isTriggered("agent-1");
        const r2 = yield* ks.isTriggered("agent-2");
        return { r1, r2 };
      }),
    );
    expect(result.r1.triggered).toBe(true);
    expect(result.r1.reason).toBe("system shutdown");
    expect(result.r2.triggered).toBe(true);
  });

  test("global kill switch can be cleared", async () => {
    const result = await run(
      Effect.gen(function* () {
        const ks = yield* KillSwitchService;
        yield* ks.triggerGlobal("test");
        yield* ks.clearGlobal();
        return yield* ks.isTriggered("agent-1");
      }),
    );
    expect(result.triggered).toBe(false);
  });

  test("global takes precedence over agent-specific clear", async () => {
    const result = await run(
      Effect.gen(function* () {
        const ks = yield* KillSwitchService;
        yield* ks.triggerGlobal("global reason");
        yield* ks.clear("agent-1"); // Only clears agent-specific
        return yield* ks.isTriggered("agent-1");
      }),
    );
    expect(result.triggered).toBe(true);
    expect(result.reason).toBe("global reason");
  });
});

describe("KillSwitchService — lifecycle API", () => {
  test("getLifecycle returns 'unknown' for unregistered agent", async () => {
    const result = await run(
      Effect.gen(function* () {
        const ks = yield* KillSwitchService;
        return yield* ks.getLifecycle("unregistered-agent");
      }),
    );
    expect(result).toBe("unknown");
  });

  test("stop() sets lifecycle to 'stopping' and waitIfPaused returns 'stopping'", async () => {
    const result = await run(
      Effect.gen(function* () {
        const ks = yield* KillSwitchService;
        yield* ks.stop("agent-stop", "graceful shutdown");
        const lifecycle = yield* ks.getLifecycle("agent-stop");
        const status = yield* ks.waitIfPaused("agent-stop");
        return { lifecycle, status };
      }),
    );
    expect(result.lifecycle).toBe("stopping");
    expect(result.status).toBe("stopping");
  });

  test("terminate() sets lifecycle to 'terminated' AND marks kill switch", async () => {
    const result = await run(
      Effect.gen(function* () {
        const ks = yield* KillSwitchService;
        yield* ks.terminate("agent-term", "critical failure");
        const lifecycle = yield* ks.getLifecycle("agent-term");
        const triggered = yield* ks.isTriggered("agent-term");
        return { lifecycle, triggered };
      }),
    );
    expect(result.lifecycle).toBe("terminated");
    expect(result.triggered.triggered).toBe(true);
    expect(result.triggered.reason).toBe("critical failure");
  });

  test("pause() then resume() unblocks and returns 'ok'", async () => {
    const sequence: string[] = [];

    await run(
      Effect.gen(function* () {
        const ks = yield* KillSwitchService;

        // Fork a fiber that pauses and waits
        const fiber = yield* Effect.fork(
          Effect.gen(function* () {
            yield* ks.pause("agent-pause");
            sequence.push("paused");
            const status = yield* ks.waitIfPaused("agent-pause");
            sequence.push(`resumed:${status}`);
          }),
        );

        // Give the fork time to pause
        yield* Effect.sleep("10 millis");
        sequence.push("resuming");
        yield* ks.resume("agent-pause");

        yield* Fiber.join(fiber);
      }),
    );

    expect(sequence).toEqual(["paused", "resuming", "resumed:ok"]);
  });

  test("waitIfPaused returns 'ok' immediately when agent is not paused", async () => {
    const result = await run(
      Effect.gen(function* () {
        const ks = yield* KillSwitchService;
        return yield* ks.waitIfPaused("agent-not-paused");
      }),
    );
    expect(result).toBe("ok");
  });
});
