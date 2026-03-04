import { describe, test, expect } from "bun:test";
import { unwrapError } from "../src/errors.js";

describe("unwrapError", () => {
  test("passes through plain Error unchanged", () => {
    const err = new Error("simple error");
    const result = unwrapError(err);
    expect(result.message).toBe("simple error");
  });

  test("extracts message from FiberFailure-like object", () => {
    // Simulate Effect's FiberFailure structure
    const innerError = new Error('Model "qwen3.5" not found locally. Run: ollama pull qwen3.5');
    const cause = {
      _tag: "Die",
      defect: innerError,
      [Symbol.for("effect/Cause")]: true,
    };
    const fiberFailure = Object.assign(
      new Error(`(FiberFailure) ${innerError.message}`),
      {
        [Symbol.for("effect/Runtime/FiberFailure")]: Symbol.for("effect/Runtime/FiberFailure"),
        [Symbol.for("effect/Runtime/FiberFailure/Cause")]: cause,
      },
    );
    const result = unwrapError(fiberFailure);
    expect(result.message).toBe('Model "qwen3.5" not found locally. Run: ollama pull qwen3.5');
  });

  test("extracts message from nested FiberFailure (double wrap)", () => {
    const innerError = new Error("LLMError: connection refused");
    const innerCause = { _tag: "Die", defect: innerError };
    const innerFF = Object.assign(new Error("(FiberFailure) inner"), {
      [Symbol.for("effect/Runtime/FiberFailure")]: true,
      [Symbol.for("effect/Runtime/FiberFailure/Cause")]: innerCause,
    });
    const outerCause = { _tag: "Die", defect: innerFF };
    const outerFF = Object.assign(new Error("(FiberFailure) (FiberFailure) inner"), {
      [Symbol.for("effect/Runtime/FiberFailure")]: true,
      [Symbol.for("effect/Runtime/FiberFailure/Cause")]: outerCause,
    });
    const result = unwrapError(outerFF);
    expect(result.message).toBe("LLMError: connection refused");
  });

  test("extracts message from Fail cause (typed errors)", () => {
    const typedError = { _tag: "ExecutionError", message: "Phase failed" };
    const cause = { _tag: "Fail", error: typedError };
    const ff = Object.assign(new Error("(FiberFailure)"), {
      [Symbol.for("effect/Runtime/FiberFailure")]: true,
      [Symbol.for("effect/Runtime/FiberFailure/Cause")]: cause,
    });
    const result = unwrapError(ff);
    expect(result.message).toBe("Phase failed");
  });

  test("handles null/undefined gracefully", () => {
    expect(unwrapError(null).message).toBe("Unknown error");
    expect(unwrapError(undefined).message).toBe("Unknown error");
  });

  test("handles plain string error", () => {
    expect(unwrapError("something broke").message).toBe("something broke");
  });
});
