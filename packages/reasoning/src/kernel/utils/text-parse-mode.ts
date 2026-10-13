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

/**
 * A tool-call example block extracted from the driver's LIVE taught
 * instructions — the W3a review-round-1 fix for the GH #243 drift class:
 * the retry nudge and the markup detector must speak the grammar the builder
 * currently teaches, never a hand-typed copy of it.
 *
 * Detection is structural, not literal: the first line that is ONLY a tag
 * (`<name>`, no colon-suffix — a taught param line like
 * `"<param-name>: <value>"` is deliberately not a lone tag) opens the
 * example block; its matching `</name>` line closes it. If a future builder
 * renames the marker or re-lays the example, this reads the NEW shape with no
 * edit on the reasoning side — and the pinned test
 * (text-parse-transition.test.ts, "failMsg quotes the LIVE taught block")
 * breaks if builder output and the shape reader ever disagree.
 */
export interface TaughtCallShape {
  /** The open marker line exactly as taught (e.g. a single-tag line). */
  readonly open: string;
  /** The matching close marker line. */
  readonly close: string;
  /** The example block verbatim from the builder output, markers included. */
  readonly block: string;
}

/**
 * Read the taught call shape from `buildPromptInstructions()` output.
 * `undefined` when no structurally-unambiguous example block exists — callers
 * MUST fail safe (treat as "no markup signal", fall through to today's path)
 * rather than guess a grammar the builder did not teach.
 */
export function readTaughtCallShape(instructions: string): TaughtCallShape | undefined {
  const lines = instructions.split("\n");
  let openIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*<[A-Za-z_][\w.-]*>\s*$/.test(lines[i] ?? "")) {
      openIdx = i;
      break;
    }
  }
  if (openIdx === -1) return undefined;
  const open = (lines[openIdx] ?? "").trim();
  const close = `</${open.slice(1, -1)}>`;
  const closeIdx = lines.findIndex((l, i) => i > openIdx && l.trim() === close);
  if (closeIdx === -1) return undefined;
  return { open, close, block: lines.slice(openIdx, closeIdx + 1).join("\n") };
}
