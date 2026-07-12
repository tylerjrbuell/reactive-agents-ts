/**
 * The sandbox must not report a failing tool as an unhandled fiber error.
 *
 * `Effect.timeoutFail` races, and racing FORKS its child. A forked child that
 * fails with no observer is reported by Effect's runtime as "Fiber terminated
 * with an unhandled error" — at Debug level, which the observability bridge
 * turns ON (effect-logger-bridge sets minimumLogLevel(Debug)). So every failing
 * tool call printed that alarming line even though the error propagated
 * correctly, and the bridge dropped the `cause`, leaving it causeless.
 *
 * Caught by the real-world probe fleet on 2026-07-12: p4 and p6 both read a
 * missing file, and both printed it mid-run while reporting success.
 *
 * The timeout case is pinned alongside so the noise can never be "fixed" by
 * removing the timeout that produced it.
 *
 * Run: bun test packages/tools/tests/execution/sandbox-unhandled-fiber.test.ts
 */
import { describe, test, expect } from "bun:test";
import { Effect, Logger, LogLevel } from "effect";

import { makeSandbox } from "../../src/execution/sandbox.js";
import { ToolExecutionError, ToolTimeoutError } from "../../src/errors.js";

const UNHANDLED = "Fiber terminated with an unhandled error";

/** Collect every log record Effect emits at Debug and above. */
function runCollectingLogs<A, E>(effect: Effect.Effect<A, E>) {
    const logs: string[] = [];
    const collector = Logger.make(({ message }) => {
        logs.push(Array.isArray(message) ? message.map(String).join(" ") : String(message));
    });
    return Effect.runPromise(
        effect.pipe(
            Effect.exit,
            Effect.provide(Logger.replace(Logger.defaultLogger, collector)),
            Logger.withMinimumLogLevel(LogLevel.Debug),
        ),
    ).then((exit) => ({ exit, logs }));
}

describe("sandbox — forked-child failure reporting", () => {
    test("a failing tool propagates its typed error WITHOUT an unhandled-fiber log", async () => {
        const sandbox = makeSandbox();
        const boom = new ToolExecutionError({
            message: "File read failed: ENOENT",
            toolName: "file-read",
        });

        const { exit, logs } = await runCollectingLogs(
            sandbox.execute(() => Effect.fail(boom), { timeoutMs: 5_000, toolName: "file-read" }),
        );

        // The error still reaches the caller, unchanged.
        expect(exit._tag).toBe("Failure");
        expect(JSON.stringify(exit)).toContain("ToolExecutionError");
        expect(JSON.stringify(exit)).toContain("ENOENT");

        // …and the runtime does NOT scream about it.
        expect(logs.filter((l) => l.includes(UNHANDLED))).toEqual([]);
    });

    test("a crashing (defect-throwing) handler still becomes a typed ToolExecutionError", async () => {
        const sandbox = makeSandbox();
        const { exit, logs } = await runCollectingLogs(
            sandbox.execute(
                () =>
                    Effect.sync<never>(() => {
                        throw new Error("kaboom");
                    }),
                { timeoutMs: 5_000, toolName: "exploder" },
            ),
        );

        expect(exit._tag).toBe("Failure");
        expect(JSON.stringify(exit)).toContain("Tool crashed");
        expect(logs.filter((l) => l.includes(UNHANDLED))).toEqual([]);
    });

    test("the timeout still fires — the fix cannot be achieved by deleting it", async () => {
        const sandbox = makeSandbox();
        const { exit } = await runCollectingLogs(
            sandbox.execute(
                () => Effect.sleep("2 seconds").pipe(Effect.as("never gets here")),
                { timeoutMs: 30, toolName: "slowpoke" },
            ),
        );

        expect(exit._tag).toBe("Failure");
        expect(JSON.stringify(exit)).toContain("ToolTimeoutError");
    });

    test("a successful tool still returns its value", async () => {
        const sandbox = makeSandbox();
        const result = await Effect.runPromise(
            makeSandbox().execute(() => Effect.succeed("ok"), { timeoutMs: 5_000, toolName: "fine" }),
        );
        expect(result).toBe("ok");
        expect(sandbox).toBeDefined();
    });
});
