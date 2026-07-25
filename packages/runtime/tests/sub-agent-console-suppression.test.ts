import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { ObservabilityService } from "@reactive-agents/observability";
import { createLightRuntime } from "../src/runtime";

describe("emitConsole: false", () => {
  test("suppresses console dashboard while still recording metrics", async () => {
    const runtime = createLightRuntime({
      agentId: "test-agent",
      provider: "test",
      model: "test-model",
      enableObservability: true,
      observabilityOptions: { verbosity: "normal", emitConsole: false },
    });

    const program = Effect.gen(function* () {
      const obs = yield* ObservabilityService;
      yield* obs.setGauge("execution.tokens_used", 42);
      return yield* obs.getDashboardData();
    });

    const logSpy = { calls: 0 };
    const originalLog = console.log;
    console.log = (...args: unknown[]) => { logSpy.calls++; originalLog(...args); };
    try {
      const data = await Effect.runPromise(Effect.provide(program, runtime));
      expect(data.tokenCount).toBe(42);
      expect(logSpy.calls).toBe(0);
    } finally {
      console.log = originalLog;
    }
  });
});
