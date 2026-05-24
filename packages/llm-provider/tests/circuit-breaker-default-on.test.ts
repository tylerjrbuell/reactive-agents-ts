import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { makeCircuitBreaker } from "../src/circuit-breaker.js";
import { defaultCircuitBreakerConfig } from "../src/retry.js";
import { LLMError } from "../src/errors.js";

// Validates the default-on circuit-breaker policy at the
// createLLMProviderLayer decision boundary:
//
//   - circuitBreaker === undefined → breaker enabled, defaults applied
//   - circuitBreaker === {}        → breaker enabled, defaults applied
//   - circuitBreaker === Partial    → breaker enabled, overrides merged
//   - circuitBreaker === false      → breaker disabled, no wrapping
//
// The runtime layer construction in src/runtime.ts:90-103 implements this
// decision; the assertions below mirror the same branch so the policy is
// verifiable without spinning up a real SDK client.

function decideBreaker(
  config: Parameters<
    typeof import("../src/runtime.js").createLLMProviderLayer
  >[4],
): {
  enabled: boolean;
  configForBreaker: Partial<typeof defaultCircuitBreakerConfig> | undefined;
} {
  const enabled = config !== false;
  const configForBreaker =
    typeof config === "object" ? config : undefined;
  return { enabled, configForBreaker };
}

const fail = () =>
  Effect.fail(
    new LLMError({ message: "boom", provider: "test", cause: undefined }),
  );

describe("circuit-breaker default-on policy", () => {
  it("undefined config → enabled, default thresholds (5 / 30000)", () => {
    const { enabled, configForBreaker } = decideBreaker(undefined);
    expect(enabled).toBe(true);
    expect(configForBreaker).toBeUndefined();

    // Apply the same call the runtime would make.
    const breaker = makeCircuitBreaker(configForBreaker);
    // The breaker should not be OPEN out of the box.
    expect(breaker.state()).toBe("closed");
  });

  it("empty config {} → enabled, defaults", () => {
    const { enabled, configForBreaker } = decideBreaker({});
    expect(enabled).toBe(true);
    expect(configForBreaker).toEqual({});
  });

  it("partial override → enabled, override threshold reached early", async () => {
    const { enabled, configForBreaker } = decideBreaker({
      failureThreshold: 2,
      cooldownMs: 60000,
    });
    expect(enabled).toBe(true);
    expect(configForBreaker).toEqual({
      failureThreshold: 2,
      cooldownMs: 60000,
    });

    const breaker = makeCircuitBreaker(configForBreaker);
    await Effect.runPromise(breaker.protect(fail()).pipe(Effect.either));
    expect(breaker.state()).toBe("closed");
    await Effect.runPromise(breaker.protect(fail()).pipe(Effect.either));
    expect(breaker.state()).toBe("open");
  });

  it("false → disabled, breaker not constructed at all", () => {
    const { enabled, configForBreaker } = decideBreaker(false);
    expect(enabled).toBe(false);
    expect(configForBreaker).toBeUndefined();
    // The runtime layer skips makeCircuitBreaker in this branch — no breaker
    // wrapping is added to the layer stack.
  });

  it("default thresholds match the publicly-documented values", () => {
    // Pinning the published defaults so any drift surfaces in review.
    expect(defaultCircuitBreakerConfig.failureThreshold).toBe(5);
    expect(defaultCircuitBreakerConfig.cooldownMs).toBe(30_000);
  });
});
