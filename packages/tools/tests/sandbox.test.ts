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
});
