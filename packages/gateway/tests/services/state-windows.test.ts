import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { TestClock, TestContext } from "effect";
import { GatewayService, GatewayServiceLive } from "../../src/services/gateway-service.js";
import { HOUR_MS, DAY_MS, rollWindows } from "../../src/services/state-windows.js";
import { initialGatewayState } from "../../src/types.js";
import type { GatewayEvent } from "../../src/types.js";

const ev = (id: string): GatewayEvent => ({
  id,
  source: "webhook",
  timestamp: new Date(),
  priority: "normal",
  payload: {},
  metadata: {},
});

describe("G1: gateway windows reset when elapsed", () => {
  test("rollWindows resets only the elapsed window", () => {
    const t0 = new Date(0);
    const s = { ...initialGatewayState(), hourWindowStart: t0, dayWindowStart: t0, actionsThisHour: 9, tokensUsedToday: 99 };
    expect(rollWindows(s, HOUR_MS - 1)).toBe(s);
    const afterHour = rollWindows(s, HOUR_MS);
    expect(afterHour.actionsThisHour).toBe(0);
    expect(afterHour.tokensUsedToday).toBe(99);
    const afterDay = rollWindows(s, DAY_MS);
    expect(afterDay.tokensUsedToday).toBe(0);
    expect(afterDay.dayWindowStart.getTime()).toBe(DAY_MS);
  });

  test("rate limit recovers after an hour (TestClock)", async () => {
    const program = Effect.gen(function* () {
      const gw = yield* GatewayService;
      for (let i = 0; i < 2; i++) {
        const d = yield* gw.processEvent(ev(`a${i}`));
        expect(d.action).toBe("execute");
      }
      const blocked = yield* gw.processEvent(ev("blocked"));
      expect(blocked.action).toBe("queue");

      yield* TestClock.adjust(HOUR_MS);
      const after = yield* gw.processEvent(ev("after"));
      expect(after.action).toBe("execute");
      expect((yield* gw.status()).state.actionsThisHour).toBe(1);
    });
    await Effect.runPromise(
      program.pipe(
        Effect.provide(GatewayServiceLive({ policies: { maxActionsPerHour: 2, dailyTokenBudget: 1_000_000 } })),
        Effect.provide(TestContext.TestContext),
      ),
    );
  });

  test("daily token budget recovers after a day (TestClock)", async () => {
    const program = Effect.gen(function* () {
      const gw = yield* GatewayService;
      yield* gw.updateTokensUsed(500);
      expect((yield* gw.processEvent(ev("over"))).action).toBe("queue");
      yield* TestClock.adjust(DAY_MS);
      expect((yield* gw.processEvent(ev("fresh"))).action).toBe("execute");
      expect((yield* gw.status()).state.tokensUsedToday).toBe(0);
    });
    await Effect.runPromise(
      program.pipe(
        Effect.provide(GatewayServiceLive({ policies: { maxActionsPerHour: 1000, dailyTokenBudget: 500 } })),
        Effect.provide(TestContext.TestContext),
      ),
    );
  });
});
