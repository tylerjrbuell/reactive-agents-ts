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
   * True for OpenAI, Gemini, and Ollama; false for Anthropic (uses tool-forcing instead).
   *
   * NOTE: reserved / informational only — NOT a routing signal. A provider lacking
   * a native JSON mode (e.g. Anthropic) still extracts reliably via the schema-aware
   * prompt path, so it must not be forced onto the heavier grounded path. Grounded
   * value comes from tool-result evidence + weak-model repair, signalled by
   * `toolsRegistered` / `calibrated`, not by the provider's response-format API.
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
 *   toolsRegistered=true  → "grounded"  (tool results give an evidence corpus to ground + cite)
 *   calibrated=false      → "grounded"  (local / uncalibrated → surgical-repair safety net)
 *   otherwise             → "fast"      (no tool corpus to ground against → grounded adds only
 *                                         an extra pass + misleading flat confidence)
 *
 * `nativeJsonMode` is intentionally NOT consulted (see RouteInput note) — a provider
 * without a native JSON mode still extracts reliably via the schema-aware prompt path.
 *
 * @returns `"fast"` or `"grounded"`
 */
export function chooseStructuredEngine(i: RouteInput): "fast" | "grounded" {
  if (i.mode === "fast") return "fast";
  if (i.mode === "grounded") return "grounded";
  // mode === "auto" — ground only when there is tool evidence or the model is unproven.
  if (i.toolsRegistered || !i.calibrated) return "grounded";
  return "fast";
}
