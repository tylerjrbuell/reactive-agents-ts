import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { ObservabilityService } from "../src/observability-service";
import { makeObservabilityTestLayer } from "./_observability-test-layer.js";

describe("ObservabilityService.getDashboardData", () => {
  test("builds DashboardData from buffered metrics without printing to console", async () => {
    const program = Effect.gen(function* () {
      const obs = yield* ObservabilityService;
      yield* obs.setGauge("execution.tokens_used", 1234);
      yield* obs.setGauge("execution.success", 1);
      const data = yield* obs.getDashboardData();
      return data;
    });

    const logSpy = { calls: 0 };
    const originalLog = console.log;
    console.log = (...args: unknown[]) => { logSpy.calls++; originalLog(...args); };
    try {
      const data = await Effect.runPromise(
        Effect.provide(program, makeObservabilityTestLayer({ console: false, verbosity: "normal" })),
      );
      expect(data.tokenCount).toBe(1234);
      expect(data.status).toBe("success");
      expect(logSpy.calls).toBe(0);
    } finally {
      console.log = originalLog;
    }
  });
});
