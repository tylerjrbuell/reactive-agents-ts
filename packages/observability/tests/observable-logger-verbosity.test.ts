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

// Repro (2026-11-04): "Direct strategy completed (1 iter cap)" printed on every
// default run. Docs promise minLevel defaults to info; debug log lines must stay
// recorded but print only when debug output was asked for.
describe("ObservableLogger debug log lines", () => {
  const debugLine = { _tag: "log", level: "debug", message: "dbg", timestamp: new Date() } as const;
  const printed = async (cfg: Parameters<typeof makeObservableLogger>[0]) => {
    const lines: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => { lines.push(String(args[0])); };
    try {
      const buffered = await Effect.runPromise(
        Effect.gen(function* () {
          const logger = yield* makeObservableLogger(cfg);
          yield* logger.emit(debugLine);
          return (yield* logger.getBuffer()).length;
        }),
      );
      return { lines: lines.length, buffered };
    } finally {
      console.log = originalLog;
    }
  };

  test("recorded but not printed at normal verbosity", async () => {
    expect(await printed({ live: true, verbosity: "normal" })).toEqual({ lines: 0, buffered: 1 });
  });

  test("printed at debug verbosity or explicit minLevel debug", async () => {
    expect((await printed({ live: true, verbosity: "debug" })).lines).toBe(1);
    expect((await printed({ live: true, verbosity: "normal", minLevel: "debug" })).lines).toBe(1);
  });
});

describe("ObservableLogger sub-agent prefix", () => {
  // Regression (2026-07-25 live E2E): a sub-agent's own ObservableLogger
  // instance printed its arrow/DEBUG lines straight to console with no
  // attribution — unlike ObservabilityService's `obs.info/debug`, which
  // execution-engine.ts already wraps with `config.logPrefix`. Under
  // concurrent sub-agents this made three children's tool-call traces
  // interleave into one indistinguishable stream. Fixed by threading the
  // same prefix into makeObservableLogger's live console.log.
  test("prepends logPrefix to the live-printed line when set", async () => {
    const lines: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => { lines.push(String(args[0])); };
    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const logger = yield* makeObservableLogger({
            live: true,
            verbosity: "normal",
            logPrefix: "  │ researcher · ",
          });
          yield* logger.emit({ _tag: "phase_started", phase: "think", timestamp: new Date() });
        }),
      );
      expect(lines[0]).toStartWith("  │ researcher · ");
    } finally {
      console.log = originalLog;
    }
  });

  test("root (no logPrefix) prints unprefixed", async () => {
    const lines: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => { lines.push(String(args[0])); };
    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const logger = yield* makeObservableLogger({ live: true, verbosity: "normal" });
          yield* logger.emit({ _tag: "phase_started", phase: "think", timestamp: new Date() });
        }),
      );
      expect(lines[0]).not.toContain("│");
    } finally {
      console.log = originalLog;
    }
  });
});
