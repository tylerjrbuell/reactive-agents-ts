/**
 * P0-3: `.withFallbacks()` behavioral coverage.
 *
 * The prior suite here was setter-only (asserted `builder.withFallbacks(...)`
 * returned `this`) and pinned a LYING event shape (`reason: "error_threshold:1"`
 * for a threshold that was never honored). Those are replaced by behavioral
 * tests of the real cascade (`cascadeWithTransitions`, which runtime.ts uses)
 * plus compile-error pins that the removed `models` / `errorThreshold` knobs are
 * gone.
 */
import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { ReactiveAgentBuilder } from "../src/builder";
import { cascadeWithTransitions } from "../src/llm-fallback-cascade";

type Resp = { content: string };
const ok = (content: string): Effect.Effect<Resp, string> => Effect.succeed({ content });
const boom = (): Effect.Effect<Resp, string> => Effect.fail("provider down");

describe("cascadeWithTransitions — real provider cascade", () => {
  test("primary success: fallback never runs, no transitions attached", async () => {
    let fallbackRan = false;
    const eff = cascadeWithTransitions(
      ["anthropic", "openai"],
      ok("primary"),
      [Effect.sync(() => (fallbackRan = true)).pipe(Effect.zipRight(ok("fallback")))],
    );
    const res = await Effect.runPromise(eff);
    expect(res.content).toBe("primary");
    expect(fallbackRan).toBe(false);
    expect((res as { fallbackTransitions?: unknown[] }).fallbackTransitions).toBeUndefined();
  });

  test("primary fails: falls through to the fallback and records the switch", async () => {
    const eff = cascadeWithTransitions(["anthropic", "openai"], boom(), [ok("fallback")]);
    const res = await Effect.runPromise(eff);
    expect(res.content).toBe("fallback");
    // Red-on-cut: if the cascade loop is removed, the primary error propagates
    // and this Promise rejects instead of yielding "fallback".
    const transitions = (res as unknown as { fallbackTransitions: Array<Record<string, unknown>> }).fallbackTransitions;
    expect(transitions).toHaveLength(1);
    expect(transitions[0]).toEqual({
      fromProvider: "anthropic",
      toProvider: "openai",
      // Honesty pin: the reason is an honest "provider_error" on the FIRST
      // error — NOT a fabricated "error_threshold:N" (the threshold that was
      // never honored is gone).
      reason: "provider_error",
      attemptNumber: 1,
    });
  });

  test("multi-fallback: transitions accumulate in order until one succeeds", async () => {
    const eff = cascadeWithTransitions(
      ["anthropic", "openai", "gemini"],
      boom(),
      [boom(), ok("gemini-result")],
    );
    const res = await Effect.runPromise(eff);
    expect(res.content).toBe("gemini-result");
    const transitions = (res as unknown as { fallbackTransitions: Array<Record<string, unknown>> }).fallbackTransitions;
    expect(transitions.map((t) => `${t.fromProvider}->${t.toProvider}`)).toEqual([
      "anthropic->openai",
      "openai->gemini",
    ]);
  });

  test("all providers fail: the error propagates", async () => {
    const eff = cascadeWithTransitions(["anthropic", "openai"], boom(), [boom()]);
    const exit = await Effect.runPromise(Effect.either(eff));
    expect(exit._tag).toBe("Left");
  });
});

describe(".withFallbacks() — removed knobs are compile errors (P0-3)", () => {
  test("providers-only config is accepted and stored", () => {
    const builder = new ReactiveAgentBuilder();
    expect(builder.withFallbacks({ providers: ["anthropic", "openai"] })).toBe(builder);
  });

  test("models / errorThreshold no longer exist on the config type", () => {
    const builder = new ReactiveAgentBuilder();
    // @ts-expect-error — `errorThreshold` was removed (never wired).
    builder.withFallbacks({ providers: ["anthropic"], errorThreshold: 3 });
    // @ts-expect-error — `models` (cheaper-model-on-429 chain) was removed.
    builder.withFallbacks({ providers: ["anthropic"], models: ["haiku"] });
  });
});
