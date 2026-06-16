/**
 * Memory / learning / lean-mode wither-body extractions
 * (WS-6 Phase 1 — memory bucket).
 *
 * The builder methods `.withoutMemory()`, `.withLearning()`,
 * `.withLeanHarness()`, and `.withMemoryConsolidation()` mutate several
 * private fields each. The bodies live here so `builder.ts` only carries the
 * public signatures + JSDoc API surface (which is load-bearing for migration
 * guidance — every method documents its canonical compose / profile
 * replacement).
 *
 * Public surface unchanged: methods still mutate `this` in place and return
 * `this`. See `applyMemoryOptions` in `../wither-applies.ts` for the original
 * extraction pattern this bucket follows.
 */
import type { ReactiveAgentBuilder } from "../../builder.js";
import { asBuilderState } from "./_state.js";

/**
 * Apply `.withoutMemory()` — force memory + skill persistence off. Memory is
 * already off in a bare builder (v0.12); this also clears it after a profile
 * or `.withMemory()` opt-in, and sets `_memoryExplicitlyDisabled` so
 * auto-enable rules don't silently turn it back on. Disables the full stack
 * (memory layer, skill persistence, session store, experience learning,
 * memory consolidation) and sets the `_memoryExplicitlyDisabled` flag so
 * downstream auto-enable rules respect the opt-out.
 */
export const applyWithoutMemory = (builder: ReactiveAgentBuilder): void => {
  const s = asBuilderState(builder);
  s._enableMemory = false;
  s._memoryExplicitlyDisabled = true;
  s._skillPersistence = false;
  s._sessionPersist = false;
  s._enableExperienceLearning = false;
  s._enableMemoryConsolidation = false;
};

/**
 * Apply `.withLearning(opts)` — bundle helper enabling the full
 * compounding-intelligence stack (memory + skill persistence + reactive
 * intelligence). Memory tier resolves from `opts.tier`; OS-default dbPath
 * applies when no explicit `opts.dbPath` is provided.
 */
export const applyWithLearning = (
  builder: ReactiveAgentBuilder,
  opts?: { tier?: "standard" | "enhanced"; dbPath?: string },
): void => {
  const s = asBuilderState(builder);
  s._enableMemory = true;
  s._memoryExplicitlyDisabled = false;
  s._memoryTier = opts?.tier === "enhanced" ? "2" : "1";
  if (opts?.dbPath) {
    s._memoryOptions = { ...s._memoryOptions, dbPath: opts.dbPath };
  }
  s._skillPersistence = true;
};

/**
 * Apply `.withLeanHarness()` — enable Pruning Principle lean mode. Bypasses
 * the terminal verifier gate, disables strategy switching (gate at
 * `runtime.ts:915`), and forces memory off per Memory v2 spec §lean-mode-
 * interaction. The single load-bearing Pruning gate in the builder lives
 * here — duplicating it elsewhere is the FM the Pruning ceiling guards.
 */
export const applyWithLeanHarness = (builder: ReactiveAgentBuilder): void => {
  const s = asBuilderState(builder);
  s._leanHarness = true;
  s._enableMemory = false;
  s._memoryExplicitlyDisabled = true;
  s._skillPersistence = false;
};

/**
 * Apply `.withMemoryConsolidation(config)` — enable the background memory
 * consolidator service (periodic consolidation + decay + pruning).
 */
export const applyWithMemoryConsolidation = (
  builder: ReactiveAgentBuilder,
  config?: {
    threshold?: number;
    decayFactor?: number;
    pruneThreshold?: number;
  },
): void => {
  const s = asBuilderState(builder);
  s._enableMemoryConsolidation = true;
  if (config) s._consolidationConfig = config;
};

