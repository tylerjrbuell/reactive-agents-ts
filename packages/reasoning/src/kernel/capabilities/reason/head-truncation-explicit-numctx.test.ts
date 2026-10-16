// Run: bun test packages/reasoning/src/kernel/capabilities/reason/head-truncation-explicit-numctx.test.ts --timeout 15000
/**
 * GH #241 — explicit `.withModel({ numCtx })` override vs the
 * head-truncation guard ceiling.
 *
 * Wire precedence (llm-provider local.ts `resolveOllamaNumCtx`):
 *   request.numCtx → config.explicitNumCtx → capability.recommendedNumCtx.
 * The guard ceiling bound to `profile.maxTokens` (recommended) only, so an
 * explicit override BELOW recommended left Ollama truncating while the guard
 * sat idle — and an override ABOVE recommended made the guard over-fire
 * (trimming a request the wire would have fit).
 *
 * The seam: `ContextProfile.explicitNumCtx` carries the user-declared window;
 * `resolveEffectiveNumCtx` mirrors the wire (`explicit ?? maxTokens`) as the
 * single ceiling for the guard preflight AND the demand-bucket cap. Default
 * no-override behavior is byte-identical (explicit absent ⇒ maxTokens).
 */
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import type { LLMMessage } from "@reactive-agents/llm-provider";
import { resolveEffectiveNumCtx } from "../../../context/context-profile.js";
import { CONTEXT_PROFILES } from "../../../context/context-profile.js";
import {
  estimateWireTokens,
  preflightHeadTruncation,
  type WireToolPayload,
} from "./head-truncation-guard.js";
import { nextNumCtx } from "../../../assembly/capability.js";

const SYS = "You are an agent. " + "identity rule. ".repeat(50);
const BUDGET = 1200;

function msg(i: number): LLMMessage {
  const pairs: string[] = [];
  for (let k = 0; k < 40; k++) pairs.push(`"f${i}-${k}":"v${i}-${k}"`);
  return { role: "user", content: `{${pairs.join(",")}}`.repeat(5) };
}

function tool(i: number): WireToolPayload {
  return {
    name: `tool-${i}`,
    description: "",
    inputSchema: {
      type: "object",
      properties: Object.fromEntries(
        Array.from({ length: 24 }, (_, k) => [`param${k}`, { type: "string", enum: ["a", "b"] }]),
      ),
      required: ["q"],
    },
  };
}

const est = (
  messages: readonly LLMMessage[],
  wireTools: readonly WireToolPayload[],
) => Effect.runPromise(estimateWireTokens(SYS, messages, wireTools, "llama"));

const base = CONTEXT_PROFILES.local;

describe("GH #241 — resolveEffectiveNumCtx mirrors the Ollama wire precedence", () => {
  it("explicit below maxTokens wins (the blind-spot direction)", () => {
    expect(resolveEffectiveNumCtx({ ...base, maxTokens: 8192, explicitNumCtx: 4096 })).toBe(4096);
  }, 15000);

  it("explicit above maxTokens wins too (else the guard over-fires on a fittable wire)", () => {
    expect(resolveEffectiveNumCtx({ ...base, maxTokens: 8192, explicitNumCtx: 32768 })).toBe(32768);
  }, 15000);

  it("absent explicit ⇒ maxTokens (default behavior unchanged)", () => {
    expect(resolveEffectiveNumCtx({ ...base, maxTokens: 8192 })).toBe(8192);
  }, 15000);

  it("both absent ⇒ undefined (guard stays ungated, as today)", () => {
    const { maxTokens: _dropped, ...rest } = base;
    expect(resolveEffectiveNumCtx({ ...rest, maxTokens: undefined })).toBeUndefined();
  }, 15000);

  it("non-positive explicit is not a window — falls back to maxTokens", () => {
    expect(resolveEffectiveNumCtx({ ...base, maxTokens: 8192, explicitNumCtx: 0 })).toBe(8192);
  }, 15000);
});

describe("GH #241 — guard enforces at the explicit ceiling (RED proof)", () => {
  it("a request fitting recommended but overflowing explicit FIRES at the effective ceiling and rests at recommended", async () => {
    const messages = Array.from({ length: 4 }, (_, i) => msg(i));
    const tools = Array.from({ length: 8 }, (_, i) => tool(i));
    const wire = await est(messages, tools);
    const recommended = wire + BUDGET + 1500;
    const explicit = wire + BUDGET - 250;
    // Sane fixture: the thread fits recommended but overflows explicit.
    expect(explicit).toBeLessThan(recommended);
    expect(wire).toBeGreaterThan(explicit - BUDGET);

    const atRecommended = await Effect.runPromise(
      preflightHeadTruncation({
        systemPrompt: SYS,
        messages,
        wireTools: tools,
        outputBudget: BUDGET,
        numCtx: resolveEffectiveNumCtx({ ...base, maxTokens: recommended }) as number,
        tokenizerFamily: "llama",
        requiredTools: [],
        relevantTools: [],
      }),
    );
    expect(atRecommended.fired).toBe(false);

    const ceiling = resolveEffectiveNumCtx({ ...base, maxTokens: recommended, explicitNumCtx: explicit });
    expect(ceiling).toBe(explicit);
    const atExplicit = await Effect.runPromise(
      preflightHeadTruncation({
        systemPrompt: SYS,
        messages,
        wireTools: tools,
        outputBudget: BUDGET,
        numCtx: ceiling as number,
        tokenizerFamily: "llama",
        requiredTools: [],
        relevantTools: [],
      }),
    );
    expect(atExplicit.fired).toBe(true);
    expect(atExplicit.stillOverflowing).toBe(false);
  }, 15000);
});

describe("GH #241 — demand-bucket path dispositions the same ceiling (COVERED, not deferred)", () => {
  it("demand growth clamps at explicit, not recommended", () => {
    const ceiling = resolveEffectiveNumCtx({ ...base, maxTokens: 32768, explicitNumCtx: 8192 });
    // A prompt needing ~20k would bucket to 32768 uncapped — the wire only has 8192.
    expect(nextNumCtx(18_000, 2000, undefined, ceiling)).toBe(8192);
  }, 15000);

  it("absent explicit, the demand cap is maxTokens exactly as today", () => {
    const ceiling = resolveEffectiveNumCtx({ ...base, maxTokens: 32768 });
    expect(nextNumCtx(18_000, 2000, undefined, ceiling)).toBe(
      nextNumCtx(18_000, 2000, undefined, 32768),
    );
  }, 15000);
});
