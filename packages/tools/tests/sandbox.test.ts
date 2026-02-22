import { Effect } from "effect";
import { describe, it, expect } from "bun:test";

import { makeSandbox } from "../src/execution/sandbox.js";
import { ToolExecutionError } from "../src/errors.js";

describe("Sandbox", () => {
  const sandbox = makeSandbox();

  it("should execute a successful effect", async () => {
    const result = await Effect.runPromise(
      sandbox.execute(() => Effect.succeed(42), {
        timeoutMs: 5000,
        toolName: "test",
      }),
    );
    expect(result).toBe(42);
  });

  it("should propagate ToolExecutionError", async () => {
    const error = await Effect.runPromise(
      sandbox
        .execute(
          () =>
            Effect.fail(
              new ToolExecutionError({
                message: "test error",
                toolName: "test",
              }),
            ),
          { timeoutMs: 5000, toolName: "test" },
        )
        .pipe(Effect.flip),
    );
    expect(error._tag).toBe("ToolExecutionError");
    expect(error.message).toBe("test error");
  });

  it("should catch defects and wrap as ToolExecutionError", async () => {
    const error = await Effect.runPromise(
      sandbox
        .execute(
          () => Effect.die("boom"),
          { timeoutMs: 5000, toolName: "crasher" },
        )
        .pipe(Effect.flip),
    );
    expect(error._tag).toBe("ToolExecutionError");
    expect(error.message).toContain("Tool crashed");
  });

  it("should timeout long-running effects", async () => {
    const error = await Effect.runPromise(
      sandbox
        .execute(
          () => Effect.sleep("10 seconds").pipe(Effect.as("done")),
          { timeoutMs: 50, toolName: "slow" },
        )
        .pipe(Effect.flip),
    );
    expect(error._tag).toBe("ToolTimeoutError");
  });

  // ─── Extended tests ───

  it("should handle concurrent executions without interference", async () => {
    const results = await Effect.runPromise(
      Effect.all(
        [
          sandbox.execute(() => Effect.succeed("a"), {
            timeoutMs: 5000,
            toolName: "tool-a",
          }),
          sandbox.execute(() => Effect.succeed("b"), {
            timeoutMs: 5000,
            toolName: "tool-b",
          }),
        ],
        { concurrency: 2 },
      ),
    );
    expect(results).toEqual(["a", "b"]);
  });

  it("should interrupt timed-out tool without affecting others", async () => {
    const results = await Effect.runPromise(
      Effect.all(
        [
          // Fast tool succeeds
          sandbox.execute(() => Effect.succeed("fast"), {
            timeoutMs: 5000,
            toolName: "fast-tool",
          }),
          // Slow tool times out — catch and map to error string
          sandbox
            .execute(
              () => Effect.sleep("10 seconds").pipe(Effect.as("slow")),
              { timeoutMs: 50, toolName: "slow-tool" },
            )
            .pipe(
              Effect.catchAll((e) => Effect.succeed(`error:${e._tag}`)),
            ),
        ],
        { concurrency: 2 },
      ),
    );
    expect(results[0]).toBe("fast");
    expect(results[1]).toBe("error:ToolTimeoutError");
  });

  it("should wrap nested effect errors, not swallow them", async () => {
    const error = await Effect.runPromise(
      sandbox
        .execute(
          () =>
            Effect.gen(function* () {
              yield* Effect.succeed("step1");
              return yield* Effect.fail(
                new ToolExecutionError({
                  message: "nested failure",
                  toolName: "nested",
                }),
              );
            }),
          { timeoutMs: 5000, toolName: "nested" },
        )
        .pipe(Effect.flip),
    );
    expect(error._tag).toBe("ToolExecutionError");
    expect(error.message).toBe("nested failure");
  });

  it("should handle very large result strings", async () => {
    const bigString = "x".repeat(1_000_000); // 1MB string
    const result = await Effect.runPromise(
      sandbox.execute(() => Effect.succeed(bigString), {
        timeoutMs: 5000,
        toolName: "big-result",
      }),
    );
    expect(result.length).toBe(1_000_000);
  });
});
