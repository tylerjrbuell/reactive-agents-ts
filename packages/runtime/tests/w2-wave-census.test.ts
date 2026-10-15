// Run: bun test packages/runtime/tests/w2-wave-census.test.ts --timeout 15000
//
// W2f (plan 2.7) — the Wave-2 census. Sibling of wither-census.test.ts; the
// same law: "every field has a consumer" is a TESTED property, not a promise.
// Every field Waves 2a-e added, consumed, or made newly-live gets a row:
// PROVEN (the named test file contains the consumer symbol AND a
// mutation-cut of that consumer was observed red — command + output in
// .superpowers/sdd/.../w2f-report.md), DEAD (zero readers -> deleted, or
// debt-registered with the proof for the removal wave), or JUSTIFIED-KEEP.
//
// Ratchets (mirroring wither-census): (1) every CONTEXT_PROFILES key has a
// row — a profile field added without classification fails CI; (2) no stale
// profile-name rows for deleted fields; (3) every PROVEN row names an
// existing test file that references its consumer symbol; (4) DEAD/JUSTIFIED
// rows carry a real reason.
import { describe, it, expect } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { CONTEXT_PROFILES, ContextProfileSchema } from "@reactive-agents/reasoning";

type Census =
  | { readonly status: "PROVEN"; readonly test: string; readonly consumer: string }
  | { readonly status: "DEAD-DELETED"; readonly reason: string }
  | { readonly status: "DEAD-DEBT-REGISTERED"; readonly reason: string }
  | { readonly status: "JUSTIFIED-KEEP"; readonly reason: string };

export const W2_FIELD_CENSUS: Readonly<Record<string, Census>> = {
  // ─── W1.3/W1.4/W1.5 thinking lineage (the wave's measurement substrate) ──
  "thinking.channel-consumption": {
    status: "PROVEN",
    test: "../../reasoning/tests/strategies/kernel/utils/thinking-channel-consumption.test.ts",
    consumer: "providerThinking",
  },
  "thinking.forensics-pair": {
    status: "PROVEN",
    test: "../../reasoning/tests/kernel/thinking-forensics-llm-exchange.test.ts",
    consumer: "thinkingChars",
  },
  "thinking.terse-answer-guard": {
    status: "PROVEN",
    test: "../../reasoning/tests/strategies/kernel/utils/terse-answer-rescue-guard.test.ts",
    consumer: "exchangeTruncated",
  },

  // ─── W2a probe ladder + store ────────────────────────────────────────────
  "probe.toolTemplateEmitsTokens": {
    status: "PROVEN",
    test: "../../llm-provider/tests/capability-ladder.test.ts",
    consumer: "toolTemplateEmitsTokens",
  },
  "probe.parameterSizeBillions": {
    status: "PROVEN",
    test: "../../llm-provider/tests/capability-ladder.test.ts",
    consumer: "parameterSizeBillions",
  },
  "store.endpoint-scoped-rows": {
    status: "PROVEN",
    test: "../../llm-provider/tests/capability-ladder.test.ts",
    consumer: "endpoint",
  },

  // ─── W2b registry-first tiering ───────────────────────────────────────────
  "tier.registry-consumption": {
    status: "PROVEN",
    test: "../../reasoning/tests/context/registry-first-tiering.test.ts",
    consumer: "resolveProfileWithWindow",
  },
  "tier.fallback-miss-sentinel": {
    status: "PROVEN",
    test: "../../reasoning/tests/context/registry-first-tiering.test.ts",
    consumer: "fallback",
  },
  provisionalTier: {
    status: "JUSTIFIED-KEEP",
    reason:
      "write-side PROVEN via registry-first-tiering.test.ts (14 provisionalTier arms; severing the resolver's mark goes red); the CODE reader is pre-registered for Wave 3 driver routing (W2b wire-or-delete disclosure) — kept because its presence is a tested fact and its absence would be silently invisible at runtime",
  },

  // ─── W2c tokenizer-aware estimation ──────────────────────────────────────
  "estimation.tokenizerFamily": {
    status: "PROVEN",
    test: "../../llm-provider/tests/tokenizer-factors.test.ts",
    consumer: "estimateTokenCount",
  },
  "estimation.factor-table": {
    status: "PROVEN",
    test: "../../llm-provider/tests/tokenizer-factors.test.ts",
    consumer: "llama",
  },

  // ─── W2d FC payload honesty + classifier-skip ─────────────────────────────
  "payload.toolSchemaDetail-wire": {
    status: "PROVEN",
    test: "../../reasoning/tests/kernel/wire-payload-honesty.test.ts",
    consumer: "names-and-types",
  },
  "classifier.skip-predicate": {
    status: "PROVEN",
    test: "../../reasoning/tests/kernel/classifier-skip-enforcement.test.ts",
    consumer: "classifierReliability",
  },
  "classifier.skip-threading": {
    status: "PROVEN",
    test: "../../reasoning/tests/kernel/classifier-skip-enforcement.test.ts",
    consumer: "strategy-switch/classifier-skip",
  },

  // ─── W2e head-truncation guard ────────────────────────────────────────────
  "guard.window-binding-recommendedNumCtx": {
    status: "PROVEN",
    test: "../../reasoning/tests/context/capability-maxtokens.test.ts",
    consumer: "applyCapabilityMaxTokens",
  },
  "guard.harness-signal": {
    status: "PROVEN",
    test: "../../reasoning/tests/kernel/head-truncation-guard.test.ts",
    consumer: "head-truncation-guard",
  },
  "guard.ledger-fact": {
    status: "PROVEN",
    test: "../../reasoning/tests/kernel/head-truncation-guard.test.ts",
    consumer: "harness_signal",
  },
  "guard.reserve": {
    status: "PROVEN",
    test: "../../reasoning/tests/kernel/head-truncation-guard-review-fixes.test.ts",
    consumer: "guardOutputReserve",
  },
  "guard.demand-schema-inclusive": {
    status: "PROVEN",
    test: "../../reasoning/tests/kernel/head-truncation-guard-review-fixes.test.ts",
    consumer: "estimateWireTokens",
  },
  "guard.pair-safe-rung": {
    status: "PROVEN",
    test: "../../reasoning/tests/kernel/head-truncation-guard-review-fixes.test.ts",
    consumer: "pair-safe",
  },

  // ─── CONTEXT_PROFILES sweep (every key; W2-relevance noted where due) ────
  tier: {
    status: "PROVEN",
    test: "../../reasoning/tests/context/context-profile-ratchet.test.ts",
    consumer: "tier",
  },
  toolResultMaxChars: {
    status: "PROVEN",
    test: "../../reasoning/tests/assembly/capability.test.ts",
    consumer: "toolResultMaxChars",
  },
  toolResultPreviewItems: {
    status: "PROVEN",
    test: "../../reasoning/tests/context/context-profile.test.ts",
    consumer: "toolResultPreviewItems",
  },
  toolSchemaDetail: {
    status: "PROVEN",
    test: "../../reasoning/tests/kernel/wire-payload-honesty.test.ts",
    consumer: "toolSchemaDetail",
  },
  maxIterations: {
    status: "PROVEN",
    test: "../../reasoning/tests/strategies/kernel/phases/max-output-tokens-recovery.test.ts",
    consumer: "maxIterations",
  },
  temperature: {
    status: "PROVEN",
    test: "../../reasoning/tests/context/context-profile.test.ts",
    consumer: "temperature",
  },
  maxTokens: {
    status: "PROVEN",
    test: "../../reasoning/tests/context/capability-maxtokens.test.ts",
    consumer: "maxTokens",
  },
  recentObservationsLimit: {
    status: "DEAD-DEBT-REGISTERED",
    reason:
      "W2f sweep proof: ZERO code readers in any src (grep repo-wide — the S2.5 'Slice C' curator consumption is gone; only a stale think.ts comment claimed it 'threads through', corrected by this dispatch) and zero test readers. Pre-existing PUBLIC profileOverrides surface defaulting 0 at every tier, so deletion is a public-API removal-wave call (authority: pre-existing fields need consumer-or-keep justification, not silent deletion) — filed as DEBT row D-2026-10-13-W2F-1: wire the curator section or delete the key",
  },
  thinkingModel: {
    status: "PROVEN",
    test: "../../reasoning/tests/context/thinking-model-profile.test.ts",
    consumer: "thinkingModel",
  },
  toolDisclosureMode: {
    status: "PROVEN",
    test: "../../reasoning/tests/kernel/head-truncation-guard.test.ts",
    consumer: "toolDisclosureMode",
  },
  toolIndexMaxEntries: {
    status: "PROVEN",
    test: "../../runtime/tests/config-serialization-drift.test.ts",
    consumer: "toolIndexMaxEntries",
  },
};

/**
 * The LIVE field set is the SCHEMA's declared fields — tier instances only
 * carry present keys, so optional fields (thinkingModel, toolIndexMaxEntries,
 * recentObservationsLimit, provisionalTier...) would be invisible to an
 * Object.keys(instance) sweep and the census would miss exactly the fields
 * most likely to be inert.
 */
function profileFieldNames(): string[] {
  return Object.keys(ContextProfileSchema.fields);
}

describe("W2f wave-2 field census", () => {
  it("every CONTEXT_PROFILES key has a census row (ratchet)", () => {
    const missing = profileFieldNames().filter((k) => !(k in W2_FIELD_CENSUS));
    expect(missing).toEqual([]);
  });

  it("no stale profile-name rows for removed fields", () => {
    const live = new Set(profileFieldNames());
    const stale = Object.keys(W2_FIELD_CENSUS).filter(
      (k) => !k.includes(".") && !live.has(k),
    );
    expect(stale).toEqual([]);
  });

  it("every PROVEN row names an existing test file that mentions its consumer", () => {
    for (const [name, proof] of Object.entries(W2_FIELD_CENSUS)) {
      if (proof.status !== "PROVEN") continue;
      const path = join(import.meta.dir, proof.test);
      expect(existsSync(path), `${name}: test file missing (${proof.test})`).toBe(true);
      const src = readFileSync(path, "utf8");
      expect(src.includes(proof.consumer), `${name}: ${proof.test} never mentions '${proof.consumer}'`).toBe(true);
    }
  });

  it("DEAD/JUSTIFIED rows carry substantive reasons (no unexplained entries)", () => {
    for (const [name, proof] of Object.entries(W2_FIELD_CENSUS)) {
      if (proof.status === "PROVEN") continue;
      expect(proof.reason.length, name).toBeGreaterThan(80);
    }
  });
});
