// Run: bun test packages/reasoning/tests/context/tier-source-of-truth.test.ts --timeout 15000
//
// Phase 1 Sprint 2 S2.2 — Tier unification regression test.
// Spec: docs/spec/docs/15-design-north-star.md §3 (Capability port).
//
// Pins the structural identity between context-profile's ModelTier and
// the canonical Capability.tier from @reactive-agents/llm-provider. After
// S2.2 lands, the two are not just equivalent — context-profile's
// ModelTier IS a re-export of the llm-provider definition. G-2 (two
// divergent ModelTier schemas) closes structurally here.
//
// If a future change re-introduces a local ModelTier literal in
// context-profile.ts (e.g. someone forks because they want a 5th tier),
// the assignability assertions below fail to compile, surfacing the
// drift at type-check time before it can ship.

import { describe, it, expect } from "bun:test";
import { Schema } from "effect";
import { ModelTier, ContextProfileSchema, CONTEXT_PROFILES } from "../../src/context/context-profile.js";
import {
  ModelTierSchema as LLMProviderModelTierSchema,
  type ModelTier as LLMProviderModelTier,
  type Capability,
} from "@reactive-agents/llm-provider";

describe("Tier unification — context-profile ModelTier === Capability.tier (S2.2)", () => {
  it("structural assignability: any context-profile ModelTier value is a valid Capability tier", () => {
    // Compile-time check via direct assignment. If the two literal unions
    // diverge, this fails to typecheck — caught by `bun run typecheck`
    // before the test even runs.
    const localTiers: readonly LLMProviderModelTier[] = [
      "local",
      "mid",
      "large",
      "frontier",
    ] satisfies readonly ModelTier[];
    expect(localTiers.length).toBe(4);
  });

  it("reverse assignability: any Capability.tier value is a valid context-profile ModelTier", () => {
    const cap = (tier: Capability["tier"]): ModelTier => tier;
    expect(cap("local")).toBe("local");
    expect(cap("mid")).toBe("mid");
    expect(cap("large")).toBe("large");
    expect(cap("frontier")).toBe("frontier");
  });

  it("both schemas accept the same 4 literal values and reject the same outliers", () => {
    const valid = ["local", "mid", "large", "frontier"];
    for (const v of valid) {
      const fromContext = Schema.decodeUnknownEither(ModelTier)(v);
      const fromLLM = Schema.decodeUnknownEither(LLMProviderModelTierSchema)(v);
      expect(fromContext._tag).toBe("Right");
      expect(fromLLM._tag).toBe("Right");
    }
    for (const bad of ["small", "medium", "supermassive", "", null, undefined, 42]) {
      const fromContext = Schema.decodeUnknownEither(ModelTier)(bad);
      const fromLLM = Schema.decodeUnknownEither(LLMProviderModelTierSchema)(bad);
      expect(fromContext._tag).toBe("Left");
      expect(fromLLM._tag).toBe("Left");
    }
  });

  it("CONTEXT_PROFILES has exactly one entry per Capability tier — no orphan, no missing", () => {
    const profileTiers = new Set(Object.keys(CONTEXT_PROFILES));
    expect(profileTiers).toEqual(new Set(["local", "mid", "large", "frontier"]));
  });

  it("ContextProfileSchema.tier accepts every literal that Capability.tier accepts", () => {
    for (const t of ["local", "mid", "large", "frontier"] as const) {
      const minimal = {
        tier: t,
        toolResultMaxChars: 1000,
        toolResultPreviewItems: 3,
        toolSchemaDetail: "names-and-types" as const,
      };
      const decoded = Schema.decodeUnknownEither(ContextProfileSchema)(minimal);
      expect(decoded._tag).toBe("Right");
    }
  });

  it("ModelTier is structurally re-exported from llm-provider (referential identity)", () => {
    // Strongest possible assertion: the two Schema values are the SAME object.
    // After S2.2 lands, context-profile.ts re-exports the llm-provider Schema
    // rather than defining its own. Before the fix, this was two separate
    // Schema.Literal(...) calls producing distinct AST nodes — equal by value
    // but not by reference. Flipping this to `===` is the explicit success
    // signal for the unification.
    expect(ModelTier).toBe(LLMProviderModelTierSchema as unknown as typeof ModelTier);
  });
});
