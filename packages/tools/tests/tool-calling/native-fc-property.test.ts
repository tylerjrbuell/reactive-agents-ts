// Run: bun test packages/tools/tests/tool-calling/native-fc-property.test.ts --timeout 30000
//
// PROPERTY tests for the native function-call resolver — the production parse
// surface for tool calls. The deterministic test provider emits CLEAN native
// FC (object args), so it structurally cannot exercise the adversarial shapes
// real providers send (stringified JSON args, malformed payloads, weird keys).
// These properties encode the INVARIANTS that must hold for ANY input, which is
// exactly the class of cross-provider bug example-based tests keep missing.
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import fc from "fast-check";
import { NativeFCStrategy } from "../../src/tool-calling/native-fc-strategy.js";
import type { ResolverInput, ResolverToolHint } from "../../src/tool-calling/types.js";

const strat = new NativeFCStrategy();
const resolve = (input: ResolverInput, tools: readonly ResolverToolHint[]) =>
  Effect.runSync(strat.resolve(input, tools));

describe("NativeFCStrategy — property invariants", () => {
  it("never throws and always returns a tagged result for ANY input", () => {
    fc.assert(
      fc.property(
        fc.record({
          content: fc.option(fc.string(), { nil: undefined }),
          toolCalls: fc.option(
            fc.array(
              fc.record({
                id: fc.string(),
                name: fc.string(),
                input: fc.oneof(fc.object(), fc.string(), fc.integer(), fc.constant(null)),
              }),
              { maxLength: 4 },
            ),
            { nil: undefined },
          ),
        }),
        fc.array(fc.record({ name: fc.string({ minLength: 1 }) }), { maxLength: 3 }),
        (input, tools) => {
          const r = resolve(input as ResolverInput, tools);
          expect(["tool_calls", "final_answer", "thinking"]).toContain(r._tag);
          if (r._tag === "tool_calls") {
            for (const c of r.calls) {
              // INVARIANT: resolved tool args are ALWAYS a plain object, never a
              // string/array/primitive — the act phase indexes args by key.
              expect(typeof c.arguments).toBe("object");
              expect(c.arguments).not.toBeNull();
              expect(Array.isArray(c.arguments)).toBe(false);
            }
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it("preserves object args verbatim for a resolved native tool call", () => {
    fc.assert(
      fc.property(
        fc.dictionary(fc.string({ minLength: 1 }), fc.integer(), { minKeys: 1, maxKeys: 5 }),
        (obj) => {
          const r = resolve(
            { toolCalls: [{ id: "1", name: "search", input: obj }] },
            [{ name: "search", paramNames: Object.keys(obj) }],
          );
          expect(r._tag).toBe("tool_calls");
          if (r._tag === "tool_calls") {
            expect(r.calls[0]!.arguments).toEqual(obj);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("does NOT silently drop stringified-JSON args (cross-provider coercion invariant)", () => {
    // Real providers (and some Ollama models) deliver tool-call arguments as a
    // JSON STRING rather than an object. Cloud adapters JSON.parse it; the local
    // adapter passes it through. The resolver is the shared chokepoint and must
    // not silently empty the args — dropping them calls the tool with no input.
    fc.assert(
      fc.property(
        fc.dictionary(fc.string({ minLength: 1 }), fc.integer(), { minKeys: 1, maxKeys: 5 }),
        (obj) => {
          const stringified = JSON.stringify(obj);
          const r = resolve(
            { toolCalls: [{ id: "1", name: "search", input: stringified }] },
            [{ name: "search", paramNames: Object.keys(obj) }],
          );
          expect(r._tag).toBe("tool_calls");
          if (r._tag === "tool_calls") {
            // Args must be recovered from the JSON string, not dropped to {}.
            expect(r.calls[0]!.arguments).toEqual(obj);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
