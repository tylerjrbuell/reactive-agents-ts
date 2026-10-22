// Run: bun test packages/core/tests/tool-effect-seam.test.ts --timeout 15000
import { describe, it, expect } from "bun:test";
import { Effect, FiberRef } from "effect";
import {
  type ToolEffectRecord,
  RecoveredToolEffectsRef,
  toolEffectIdentityKey,
  canonicalToolArgsJson,
  computeTrustReceipt,
} from "../src/index.js";

describe("tool-effect seam (durable crash-window recovery, GH #262)", () => {
  it("Record type accepts a well-formed executing record", () => {
    const record: ToolEffectRecord = {
      toolName: "delete-records",
      argsJson: '{"confirm":true}',
      status: "executing",
      toolCallId: "call_abc",
      iteration: 2,
      effectId: "fx-t1-2-0",
    };
    expect(record.status).toBe("executing");
    expect("resultContent" in record).toBe(false);
  });

  it("RecoveredToolEffectsRef defaults to null and accepts a locally seeded map", async () => {
    const prog = Effect.gen(function* () {
      const base = yield* FiberRef.get(RecoveredToolEffectsRef);
      const seeded = yield* FiberRef.get(RecoveredToolEffectsRef).pipe(
        Effect.locally(
          RecoveredToolEffectsRef,
          new Map([
            [
              'delete-records\x00{"confirm":true}',
              {
                toolName: "delete-records",
                argsJson: '{"confirm":true}',
                status: "succeeded" as const,
                resultContent: "deleted 3 records",
                toolCallId: "call_abc",
                iteration: 2,
              },
            ],
          ]),
        ),
      );
      return { base, seeded };
    });
    const { base, seeded } = await Effect.runPromise(prog);
    expect(base).toBeNull();
    const recovered = seeded?.get('delete-records\x00{"confirm":true}');
    expect(recovered?.status).toBe("succeeded");
    expect(recovered?.resultContent).toBe("deleted 3 records");
  });

  it("toolEffectIdentityKey joins tool name and canonical args and is order-independent", () => {
    const a = toolEffectIdentityKey("delete-records", canonicalToolArgsJson({ confirm: true, scope: "user" }));
    const b = toolEffectIdentityKey("delete-records", canonicalToolArgsJson({ scope: "user", confirm: true }));
    expect(a).toBe(b);
    expect(toolEffectIdentityKey("delete-records", canonicalToolArgsJson({ confirm: false }))).not.toBe(b);
  });

  it("canonicalToolArgsJson handles nested objects and primitives deterministically", () => {
    expect(
      canonicalToolArgsJson({ b: 1, a: { y: 2, x: [3, 1] } }),
    ).toBe(
      JSON.stringify({ a: { x: [3, 1], y: 2 }, b: 1 }),
    );
    expect(canonicalToolArgsJson("plain")).toBe('"plain"');
    expect(canonicalToolArgsJson(undefined)).toBe("undefined");
  });

  describe("computeTrustReceipt effects passthrough", () => {
    const baseInput = {
      toolCalls: [{ name: "delete-records", ok: true }],
      abstained: false,
      success: true,
      modelId: "test-model",
      now: 1_000,
    };

    it("stays byte-identical when effects is absent or empty", () => {
      const without = computeTrustReceipt({ ...baseInput });
      const withEmpty = computeTrustReceipt({ ...baseInput, effects: [] });
      const plain = Object.keys(without);
      const empty = Object.keys(withEmpty);
      expect(empty).toEqual(plain);
      expect("effects" in without).toBe(false);
      expect("effects" in withEmpty).toBe(false);
    });

    it("binds each recovery/ambiguity outcome to the stable identity", () => {
      const receipt = computeTrustReceipt({
        ...baseInput,
        effects: [
          {
            toolName: "delete-records",
            argsJson: '{"confirm":true}',
            status: "recovered",
            effectId: "fx-t1-2-0",
            iteration: 2,
          },
          {
            toolName: "send-email",
            argsJson: '{"to":"ops"}',
            status: "ambiguous-then-replayed",
            effectId: "fx-unknown-3-0",
            iteration: 3,
          },
        ],
      });
      expect(receipt.effects?.[0].status).toBe("recovered");
      expect(receipt.effects?.[1].status).toBe("ambiguous-then-replayed");
      expect(receipt.effects?.[0].toolName).toBe("delete-records");
    });
  });
});
