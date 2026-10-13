/**
 * W3a Stage B — the ONE decision point for the text-parse think→acting
 * transition (spec wiki/Architecture/Design-Specs/
 * 2026-06-03-tool-calling-driver-redesign.md, Stage B).
 *
 * `REACTIVE_AGENTS_TEXT_PARSE=off|shadow|act`:
 *   - `off` (default, unset, or any invalid value) — today's behavior,
 *     byte-unchanged: a `TextParseDriver` run has no think→acting transition
 *     (the Stage-A state; the driver was routed but the dispatch path was
 *     unbuilt, so a dialect-`none` model burns maxIterations on markup).
 *   - `shadow` — think.ts runs the driver's parse on the current turn's text
 *     and records a parse-diff diagnostic (what the parser saw vs. what the
 *     loop did — nothing) WITHOUT touching the transition. Promotion to act
 *     is a later measured decision (plan 3.5: shadow-first).
 *   - `act` — parsed calls transition the loop to `acting`, landing on the
 *     SAME `handleActing` pipeline native-fc uses (guards, policy choke
 *     point, HealingPipeline, ledger seam). Markup that fails to parse loops
 *     back with a deterministic observation-shaped message — never silent.
 *
 * House env pattern (`REACTIVE_AGENTS_EVIDENCE_DELTA_RESET` in
 * assessment/guard-adapters.ts, `REACTIVE_AGENTS_NOOP_VERIFIER` in
 * state/build-kernel-input.ts): a direct `process.env` read at exactly one
 * decided function, no new globals, no builder surface. This module is the
 * single reader; `think.ts` calls it once per text-parse think turn.
 */

/** The env var name — exported so tests and docs reference one string. */
export const TEXT_PARSE_MODE_ENV = "REACTIVE_AGENTS_TEXT_PARSE";

/** The three states of the Stage-B rollout flag. */
export type TextParseTransitionMode = "off" | "shadow" | "act";

/**
 * Read the transition mode. Any unset/invalid value is `off` — the flag can
 * only ever ADD the text-parse transition, never alter native-fc behavior,
 * and a typo'd value fails safe to today's semantics.
 */
export function readTextParseTransitionMode(): TextParseTransitionMode {
  const raw = process.env[TEXT_PARSE_MODE_ENV];
  if (raw === "shadow" || raw === "act") return raw;
  return "off";
}
