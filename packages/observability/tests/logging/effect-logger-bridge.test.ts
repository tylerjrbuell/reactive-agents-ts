import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { makeObservableLogger } from "../../src/logging/observable-logger.js";
import { effectLoggerBridgeLayer } from "../../src/logging/effect-logger-bridge.js";
import type { LogEvent } from "../../src/types.js";

/**
 * `execution-engine.ts` provided `Logger.replace(Logger.defaultLogger, Logger.none)`,
 * which DISCARDED every `Effect.logDebug` / `Effect.logWarning` in the kernel —
 * while `core/src/errors/index.ts` instructs authors to prefer exactly those
 * calls over `console.*`. Silencing stdout was the goal; dropping the record was
 * collateral damage.
 *
 * The bridge routes Effect's own logging into the ObservableLogger so the
 * records survive, without printing to stdout when the logger is not `live`.
 */
const collect = async (
  effect: Effect.Effect<unknown, never, never>,
  opts?: { live?: boolean },
): Promise<readonly LogEvent[]> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const logger = yield* makeObservableLogger({ live: opts?.live ?? false });
      yield* effect.pipe(Effect.provide(effectLoggerBridgeLayer(logger, "debug")));
      // The bridge emits on a detached fiber; let it drain.
      yield* Effect.sleep("50 millis");
      return yield* logger.getBuffer();
    }),
  );

describe("effect logger bridge", () => {
  it("Effect.logWarning reaches the observable logger instead of /dev/null", async () => {
    const events = await collect(Effect.logWarning("kernel says something is off"));

    const logs = events.filter((e) => e._tag === "log");
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      _tag: "log",
      level: "warn",
      message: "kernel says something is off",
    });
  });

  it("preserves the level of each Effect.log* variant", async () => {
    const events = await collect(
      Effect.gen(function* () {
        yield* Effect.logDebug("d");
        yield* Effect.logInfo("i");
        yield* Effect.logWarning("w");
        yield* Effect.logError("e");
      }),
    );

    const levels = events
      .filter((e) => e._tag === "log")
      .map((e) => (e as { level: string }).level);
    expect(levels).toEqual(["debug", "info", "warn", "error"]);
  });

  it("does NOT print to stdout when the logger is not live (status mode stays clean)", async () => {
    const written: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => {
      written.push(args.map(String).join(" "));
    };

    try {
      const events = await collect(Effect.logWarning("quiet please"), { live: false });
      expect(events.filter((e) => e._tag === "log")).toHaveLength(1); // record survives
      expect(written).toHaveLength(0); // ...but stdout stays clean
    } finally {
      console.log = original;
    }
  });

  it("carries Effect log annotations through as fields", async () => {
    const events = await collect(
      Effect.logInfo("annotated").pipe(Effect.annotateLogs("toolName", "file-read")),
    );

    const log = events.find((e) => e._tag === "log") as
      | { fields?: Record<string, unknown> }
      | undefined;
    expect(log?.fields).toMatchObject({ toolName: "file-read" });
  });
});
