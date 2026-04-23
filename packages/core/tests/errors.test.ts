import { describe, expect, it } from "bun:test";
import { Effect, pipe } from "effect";
import {
  AgentError,
  AgentNotFoundError,
  CapabilityError,
  CapacityError,
  ContractError,
  LLMRateLimitError,
  LLMTimeoutError,
  ModelCapabilityError,
  RuntimeError,
  SecurityError,
  TaskError,
  ToolCapabilityViolation,
  ToolIdempotencyViolation,
  TransientError,
  ValidationError,
  VerificationFailed,
  isRetryable,
} from "../src/errors/index.js";

describe("FrameworkError taxonomy", () => {
  it("every top-level kind has a unique _tag", () => {
    const tags = [
      new TransientError({ message: "x" })._tag,
      new CapacityError({ message: "x" })._tag,
      new CapabilityError({ message: "x" })._tag,
      new ContractError({ message: "x" })._tag,
      new TaskError({ message: "x" })._tag,
      new SecurityError({ message: "x" })._tag,
    ];
    expect(new Set(tags).size).toBe(tags.length);
  });

  it("each subtype carries a unique _tag", () => {
    expect(
      new LLMRateLimitError({
        retryAfterMs: 1000,
        provider: "anthropic",
        message: "rate limit",
      })._tag,
    ).toBe("LLMRateLimitError");

    expect(
      new LLMTimeoutError({ elapsedMs: 5000, message: "timeout" })._tag,
    ).toBe("LLMTimeoutError");

    expect(
      new ToolCapabilityViolation({
        toolName: "web-search",
        attempted: ["net:*"],
        granted: ["net:google.com"],
        message: "violation",
      })._tag,
    ).toBe("ToolCapabilityViolation");

    expect(
      new VerificationFailed({
        gaps: ["missing claim"],
        suggestedAction: "nudge",
        message: "failed",
      })._tag,
    ).toBe("VerificationFailed");

    expect(
      new ToolIdempotencyViolation({
        toolName: "write-file",
        message: "retry on non-idempotent",
      })._tag,
    ).toBe("ToolIdempotencyViolation");

    expect(
      new ModelCapabilityError({
        provider: "ollama",
        model: "qwen3:14b",
        required: "vision",
        message: "model lacks vision",
      })._tag,
    ).toBe("ModelCapabilityError");
  });

  it(
    "Effect.catchTag pattern-matches on _tag",
    async () => {
      const program = pipe(
        Effect.fail(
          new LLMRateLimitError({
            retryAfterMs: 500,
            provider: "openai",
            message: "rate limited",
          }),
        ),
        Effect.catchTag("LLMRateLimitError", (e) =>
          Effect.succeed({
            retryAfterMs: e.retryAfterMs,
            provider: e.provider,
          }),
        ),
      );
      const result = await Effect.runPromise(program);
      expect(result).toEqual({ retryAfterMs: 500, provider: "openai" });
    },
    15000,
  );

  it("isRetryable classifies Transient + Capacity kinds as retryable", () => {
    expect(isRetryable(new TransientError({ message: "x" }))).toBe(true);
    expect(isRetryable(new CapacityError({ message: "x" }))).toBe(true);
    expect(isRetryable(new LLMRateLimitError({ message: "x" }))).toBe(true);
    expect(
      isRetryable(new LLMTimeoutError({ elapsedMs: 1000, message: "x" })),
    ).toBe(true);
  });

  it("isRetryable classifies Capability/Contract/Task/Security as NOT retryable", () => {
    expect(isRetryable(new CapabilityError({ message: "x" }))).toBe(false);
    expect(isRetryable(new ContractError({ message: "x" }))).toBe(false);
    expect(isRetryable(new TaskError({ message: "x" }))).toBe(false);
    expect(isRetryable(new SecurityError({ message: "x" }))).toBe(false);
    expect(
      isRetryable(
        new VerificationFailed({
          gaps: [],
          suggestedAction: "abandon",
          message: "x",
        }),
      ),
    ).toBe(false);
  });

  it("isRetryable returns false for non-framework inputs", () => {
    expect(isRetryable(null)).toBe(false);
    expect(isRetryable(undefined)).toBe(false);
    expect(isRetryable("just a string")).toBe(false);
    expect(isRetryable(42)).toBe(false);
    expect(isRetryable(new Error("native"))).toBe(false);
  });

  it("LLMRateLimitError carries retryAfterMs metadata", () => {
    const err = new LLMRateLimitError({
      retryAfterMs: 2000,
      provider: "anthropic",
      message: "rate limited",
    });
    expect(err.retryAfterMs).toBe(2000);
    expect(err.provider).toBe("anthropic");
  });

  it("VerificationFailed carries suggestedAction", () => {
    const err = new VerificationFailed({
      gaps: ["gap1", "gap2"],
      suggestedAction: "retry-with-guidance",
      message: "verify failed",
    });
    expect(err.gaps).toEqual(["gap1", "gap2"]);
    expect(err.suggestedAction).toBe("retry-with-guidance");
  });

  it("ToolCapabilityViolation carries attempted/granted arrays", () => {
    const err = new ToolCapabilityViolation({
      toolName: "code-execute",
      attempted: ["fs:*"],
      granted: ["fs:/tmp/*"],
      message: "scope violation",
    });
    expect(err.toolName).toBe("code-execute");
    expect(err.attempted).toEqual(["fs:*"]);
    expect(err.granted).toEqual(["fs:/tmp/*"]);
  });

  it("existing TaskError accepts widened optional taskId (backward compat)", () => {
    // Old call-site shape (taskId present)
    const withTaskId = new TaskError({
      taskId: "t1",
      message: "task failed",
    });
    expect(withTaskId.taskId).toBe("t1");

    // New call-site shape (taskId omitted)
    const withoutTaskId = new TaskError({ message: "task malformed" });
    expect(withoutTaskId.taskId).toBeUndefined();
  });

  it("pre-existing error classes still export correctly", () => {
    // Existing consumers (task-service, execution-engine, tests) rely on
    // these classes staying importable from @reactive-agents/core.
    expect(new AgentError({ message: "x" })._tag).toBe("AgentError");
    expect(
      new AgentNotFoundError({ agentId: "a1", message: "x" })._tag,
    ).toBe("AgentNotFoundError");
    expect(
      new ValidationError({ field: "f", message: "x" })._tag,
    ).toBe("ValidationError");
    expect(new RuntimeError({ message: "x" })._tag).toBe("RuntimeError");
  });
});
