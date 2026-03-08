// File: tests/circuit-breaker.test.ts
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { makeCircuitBreaker } from "../src/circuit-breaker.js";
import { LLMError } from "../src/errors.js";

const fail = () =>
  Effect.fail(
    new LLMError({ message: "boom", provider: "test", cause: undefined }),
  );

const succeed = () => Effect.succeed("ok" as const);

describe("CircuitBreaker", () => {
  it("passes through when closed", async () => {
    const cb = makeCircuitBreaker({ failureThreshold: 3, cooldownMs: 1000 });
    const result = await Effect.runPromise(cb.protect(succeed()));
    expect(result).toBe("ok");
    expect(cb.state()).toBe("closed");
  });

  it("stays closed under threshold", async () => {
    const cb = makeCircuitBreaker({ failureThreshold: 3, cooldownMs: 1000 });
    // 2 failures < threshold of 3
    for (let i = 0; i < 2; i++) {
      await Effect.runPromise(cb.protect(fail()).pipe(Effect.either));
    }
    expect(cb.state()).toBe("closed");
  });

  it("opens after threshold consecutive failures", async () => {
    const cb = makeCircuitBreaker({ failureThreshold: 3, cooldownMs: 60000 });
    for (let i = 0; i < 3; i++) {
      await Effect.runPromise(cb.protect(fail()).pipe(Effect.either));
    }
    expect(cb.state()).toBe("open");
  });

  it("fast-fails when open", async () => {
    const cb = makeCircuitBreaker({ failureThreshold: 1, cooldownMs: 60000 });
    // Trip the breaker
    await Effect.runPromise(cb.protect(fail()).pipe(Effect.either));
    expect(cb.state()).toBe("open");

    // Next call should fail with circuit breaker message
    const result = await Effect.runPromise(
      cb.protect(succeed()).pipe(Effect.either),
    );
    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left.message).toContain("Circuit breaker OPEN");
    }
  });

  it("transitions to half-open after cooldown", async () => {
    const cb = makeCircuitBreaker({ failureThreshold: 1, cooldownMs: 1 });
    await Effect.runPromise(cb.protect(fail()).pipe(Effect.either));
    expect(cb.state()).toBe("open");

    // Wait for cooldown
    await new Promise((r) => setTimeout(r, 10));

    // Next call should transition to half-open and pass through
    const result = await Effect.runPromise(cb.protect(succeed()));
    expect(result).toBe("ok");
    expect(cb.state()).toBe("closed");
  });

  it("re-opens if half-open test fails", async () => {
    const cb = makeCircuitBreaker({ failureThreshold: 1, cooldownMs: 1 });
    await Effect.runPromise(cb.protect(fail()).pipe(Effect.either));

    await new Promise((r) => setTimeout(r, 10));

    // Half-open test fails → back to open
    await Effect.runPromise(cb.protect(fail()).pipe(Effect.either));
    expect(cb.state()).toBe("open");
  });

  it("resets counter on success", async () => {
    const cb = makeCircuitBreaker({ failureThreshold: 3, cooldownMs: 1000 });
    // 2 failures
    await Effect.runPromise(cb.protect(fail()).pipe(Effect.either));
    await Effect.runPromise(cb.protect(fail()).pipe(Effect.either));
    // 1 success resets counter
    await Effect.runPromise(cb.protect(succeed()));
    // 2 more failures should NOT trip (counter reset)
    await Effect.runPromise(cb.protect(fail()).pipe(Effect.either));
    await Effect.runPromise(cb.protect(fail()).pipe(Effect.either));
    expect(cb.state()).toBe("closed");
  });

  it("reset() forces closed state", async () => {
    const cb = makeCircuitBreaker({ failureThreshold: 1, cooldownMs: 60000 });
    await Effect.runPromise(cb.protect(fail()).pipe(Effect.either));
    expect(cb.state()).toBe("open");
    cb.reset();
    expect(cb.state()).toBe("closed");
  });
});
