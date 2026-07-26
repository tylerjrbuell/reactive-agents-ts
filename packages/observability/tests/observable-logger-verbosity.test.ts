import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { makeObservableLogger } from "../src/logging/observable-logger";

describe("ObservableLogger minimal verbosity", () => {
  test("does not print to console when verbosity is minimal, even with live:true", async () => {
    const logSpy = { calls: 0 };
    const originalLog = console.log;
    console.log = (...args: unknown[]) => { logSpy.calls++; originalLog(...args); };
    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const logger = yield* makeObservableLogger({ live: true, verbosity: "minimal" });
          yield* logger.emit({ _tag: "phase_started", phase: "think", timestamp: new Date() });
        }),
      );
      expect(logSpy.calls).toBe(0);
    } finally {
      console.log = originalLog;
    }
  });

  test("still prints at normal verbosity with live:true", async () => {
    const logSpy = { calls: 0 };
    const originalLog = console.log;
    console.log = (...args: unknown[]) => { logSpy.calls++; originalLog(...args); };
    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const logger = yield* makeObservableLogger({ live: true, verbosity: "normal" });
          yield* logger.emit({ _tag: "phase_started", phase: "think", timestamp: new Date() });
        }),
      );
      expect(logSpy.calls).toBe(1);
    } finally {
      console.log = originalLog;
    }
  });
});
