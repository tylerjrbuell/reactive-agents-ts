import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { makeStructuredLogger } from "../../src/logging/structured-logger.js";

/**
 * LogEntrySchema has declared `agentId` / `sessionId` / `traceId` / `spanId`
 * since it was written, and `makeStructuredLogger` never wrote any of them.
 * `getLogs({ agentId })` therefore filtered on a field that was always
 * undefined — a dead filter that silently returned nothing.
 */
describe("structured logger correlation", () => {
  it("stamps the correlation context onto every entry", async () => {
    const entries = await Effect.runPromise(
      Effect.gen(function* () {
        const logger = yield* makeStructuredLogger({
          context: Effect.succeed({
            agentId: "agent-a",
            sessionId: "sess-1",
            traceId: "trace-9",
            spanId: "span-3",
          }),
        });
        yield* logger.info("hello");
        return yield* logger.getLogs();
      }),
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      level: "info",
      message: "hello",
      agentId: "agent-a",
      sessionId: "sess-1",
      traceId: "trace-9",
      spanId: "span-3",
    });
  });

  it("getLogs({ agentId }) actually filters (it was a dead filter)", async () => {
    const entries = await Effect.runPromise(
      Effect.gen(function* () {
        const a = yield* makeStructuredLogger({
          context: Effect.succeed({ agentId: "agent-a" }),
        });
        yield* a.info("from a");
        const matching = yield* a.getLogs({ agentId: "agent-a" });
        const nonMatching = yield* a.getLogs({ agentId: "agent-b" });
        return { matching, nonMatching };
      }),
    );

    expect(entries.matching).toHaveLength(1);
    expect(entries.nonMatching).toHaveLength(0);
  });

  it("resolves the context per-call, so a changing trace context is tracked", async () => {
    let spanCounter = 0;
    const entries = await Effect.runPromise(
      Effect.gen(function* () {
        const logger = yield* makeStructuredLogger({
          context: Effect.sync(() => ({ spanId: `span-${++spanCounter}` })),
        });
        yield* logger.info("first");
        yield* logger.info("second");
        return yield* logger.getLogs();
      }),
    );

    expect(entries[0]?.spanId).toBe("span-1");
    expect(entries[1]?.spanId).toBe("span-2");
  });

  it("without a context provider, entries are unstamped (back-compat)", async () => {
    const entries = await Effect.runPromise(
      Effect.gen(function* () {
        const logger = yield* makeStructuredLogger();
        yield* logger.info("plain");
        return yield* logger.getLogs();
      }),
    );

    expect(entries[0]?.message).toBe("plain");
    expect(entries[0]?.agentId).toBeUndefined();
  });
});
