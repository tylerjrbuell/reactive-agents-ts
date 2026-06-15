/**
 * Structured output engine routing — pure decision function.
 *
 * Chooses between the "fast" path (single LLM extraction call) and the
 * "grounded" path (multi-step verification, Phase 2 / Task 2.5) based on:
 *   1. An explicit mode override from the caller.
 *   2. Provider capabilities (nativeJsonMode) + calibration state + tool presence.
 *
 * This module is intentionally free of side effects and Effect imports so it
 * can be unit-tested with plain `bun:test` without a runtime.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RouteInput {
  /** Explicit mode requested by the caller, or "auto" to let the function decide. */
  readonly mode: "auto" | "fast" | "grounded";
  /**
   * Whether the provider supports native JSON-mode output.
   * True for OpenAI, Gemini, and Ollama; false for Anthropic (uses prefill instead).
   */
  readonly nativeJsonMode: boolean;
  /**
   * Whether the agent has at least one tool registered.
   * Tool-using agents benefit from the grounded path because the fast path
   * extracts from a prose answer rather than structured tool results.
   */
  readonly toolsRegistered: boolean;
  /**
   * Whether the agent has been calibrated (i.e. is operating on a frontier
   * provider with known output quality). Uncalibrated / local-only agents
   * should prefer the grounded path for extra reliability.
   */
  readonly calibrated: boolean;
}

// ─── Implementation ───────────────────────────────────────────────────────────

/**
 * Choose the structured output engine based on routing signals.
 *
 * Decision table for `mode: "auto"`:
 *   toolsRegistered=true  → "grounded"  (tool results need structured assembly)
 *   calibrated=false      → "grounded"  (local / uncalibrated → extra safety)
 *   nativeJsonMode=false  → "grounded"  (provider can't enforce JSON)
 *   otherwise             → "fast"      (frontier + native JSON + no tools)
 *
 * @returns `"fast"` or `"grounded"`
 */
export function chooseStructuredEngine(i: RouteInput): "fast" | "grounded" {
  if (i.mode === "fast") return "fast";
  if (i.mode === "grounded") return "grounded";
  // mode === "auto"
  if (i.toolsRegistered || !i.calibrated || !i.nativeJsonMode) return "grounded";
  return "fast";
}
