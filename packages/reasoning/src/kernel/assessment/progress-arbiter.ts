// File: src/kernel/assessment/progress-arbiter.ts
//
// Progress arbiter — design law #5 (ONE progress arbiter, Wave 4 task 4.7).
//
// A single pure predicate classifies every step / observation / output as
// SUBSTANTIVE vs NON-PROGRESS (a framework helper, a no-op, or a give-up /
// non-answer), and every "did we progress / did we succeed" consumer derives
// from it. This mirrors design law #1 (one capability arbiter) for the PROGRESS
// dimension. It is the structural root fix behind loop-detector patterns
// (a)/(c)/(d) and 4.1's new (e), and behind assess()'s evidenceDelta crediting
// (task 4.6).
//
// WHY THIS EXISTS: the loop detector counted a META_TOOL call as progress,
// contradicting META_TOOLS' own contract ("not counted as real work for
// completion detection, deliverable assembly, or loop detection"). The dominant
// pathology — varied args, success:true, zero new evidence (the frozen S3
// thrash: 146 `discover-tools` calls, "No tools registered.", evidenceDelta:0 on
// every assessment) — therefore tripped neither the byte-identical repeat (a)
// nor the same-name/no-success (d) guards. Routing all the guards through ONE
// predicate is what removes that structural blindness; a `discover-tools`-only
// patch would leave the class open.
//
// DAG law: pure, synchronous, no Effect, no state, no ledger. It classifies a
// value; it never recomputes assessment or mutates anything. Consumers READ it.
//
// SIBLING FAILURE MODES (plan §4.7 enumeration) — disposition:
//   1. meta/pseudo-tool thrash counted as progress        → FIXED here (4.7)
//   2. "successful" no-op credited as grounded evidence   → FIXED here (4.6)
//   3. give-up answer counted as delivered                 → predicate provided
//      (`classifyOutput`); consumer wiring owned by task 5.1 (terminal honesty)
//   4. reworded repeats defeating byte-equality thought dedup → covered by the
//      non-progress step class (a reworded repeat is still a non-progress step)
//   5. delegated children laundering a partial into a completed parent → out of
//      scope here; owned by task 5.3 (`joinEnvelopes` worst-of)

import { HARNESS_PSEUDO_TOOLS, META_TOOLS } from "../state/kernel-constants.js";
import type { ReasoningStep } from "../../types/index.js";

/** The law-#5 classification. */
export type ProgressClass = "substantive" | "non-progress";

/** Why a value was classified NON-PROGRESS (auditable + message-usable). */
export type NonProgressKind = "failed" | "meta-tool" | "pseudo-tool" | "no-op" | "give-up";

/** The arbiter's verdict on one step / observation / output. */
export interface ProgressVerdict {
  readonly kind: ProgressClass;
  /** Present iff `kind === "non-progress"`. */
  readonly reason?: NonProgressKind;
}

const SUBSTANTIVE: ProgressVerdict = { kind: "substantive" };

function nonProgress(reason: NonProgressKind): ProgressVerdict {
  return { kind: "non-progress", reason };
}

/**
 * Degenerate-result markers: a success-shaped tool result whose content carries
 * no task evidence. Kept deliberately NARROW (only unambiguous harness/no-op
 * phrasings) so a substantive result that merely *contains* a word like "cannot"
 * is never misclassified — a false NON-PROGRESS would suppress real progress.
 */
const NO_OP_MARKERS: readonly string[] = [
  "no tools registered",
  "no tools available",
  "no results found",
  "nothing to do",
  "nothing to report",
  "already done",
];

/**
 * Give-up / non-answer markers for a run OUTPUT (sibling failure mode 3). The
 * predicate is provided for terminal-honesty consumers (task 5.1); this wave
 * does not wire it.
 */
const GIVE_UP_MARKERS: readonly string[] = [
  "i'm unable to",
  "i am unable to",
  "unable to complete",
  "cannot complete",
  "can't complete",
  "i could not complete",
];

/**
 * A no-op result is SHORT and degenerate. A long result that merely mentions a
 * marker phrase (e.g. a file body containing "already done") is substantive —
 * the length cap + word-boundary match prevent that misclassification.
 */
const NO_OP_MAX_LENGTH = 200;

/** Whole-word/phrase occurrence of `needle` (already lower-cased) in `haystack`. */
function hasMarker(haystack: string, needle: string): boolean {
  const idx = haystack.indexOf(needle);
  if (idx === -1) return false;
  const before = idx === 0 ? "" : haystack[idx - 1]!;
  const afterIdx = idx + needle.length;
  const after = afterIdx >= haystack.length ? "" : haystack[afterIdx]!;
  const isBoundary = (ch: string): boolean => ch === "" || !/[a-z0-9]/.test(ch);
  return isBoundary(before) && isBoundary(after);
}

/**
 * Does this tool-result content add no task evidence? Empty / whitespace-only
 * content, or a SHORT degenerate phrasing, counts as a no-op. A long result that
 * merely contains a marker word does NOT (word-boundary + length cap).
 */
export function contentIsNoOp(content: string | undefined): boolean {
  if (content === undefined) return true;
  const t = content.trim().toLowerCase();
  if (t.length === 0) return true;
  if (t.length > NO_OP_MAX_LENGTH) return false;
  return NO_OP_MARKERS.some((m) => hasMarker(t, m));
}

/** Is this tool name a framework META tool (harness helper, not real work)? */
export function isMetaTool(toolName: string | undefined): boolean {
  return toolName !== undefined && META_TOOLS.has(toolName);
}

/** Is this tool name a HARNESS pseudo tool (injected feedback, not a call)? */
export function isPseudoTool(toolName: string | undefined): boolean {
  return toolName !== undefined && HARNESS_PSEUDO_TOOLS.has(toolName);
}

/**
 * Classify a tool RESULT's contribution to run progress. This is the arbiter
 * core reused by assess() (evidenceDelta) and the loop detector.
 *
 * NON-PROGRESS iff: the call failed; OR the tool is a META tool; OR the tool is
 * a HARNESS pseudo tool; OR the successful result content is a no-op. Everything
 * else is SUBSTANTIVE.
 */
export function classifyToolResult(
  toolName: string | undefined,
  success: boolean,
  content: string | undefined,
): ProgressVerdict {
  if (!success) return nonProgress("failed");
  if (isMetaTool(toolName)) return nonProgress("meta-tool");
  if (isPseudoTool(toolName)) return nonProgress("pseudo-tool");
  if (contentIsNoOp(content)) return nonProgress("no-op");
  return SUBSTANTIVE;
}

/** Convenience boolean: does this tool result CREDIT run progress/evidence? */
export function creditsEvidence(
  toolName: string | undefined,
  success: boolean,
  content: string | undefined,
): boolean {
  return classifyToolResult(toolName, success, content).kind === "substantive";
}

/** The observation facts the arbiter needs to classify an action step. */
export interface ObservationLike {
  readonly success?: boolean;
  readonly content?: string;
}

/** The tool name stamped on an action step's `toolCall` metadata, if any. */
export function actionToolName(step: ReasoningStep): string | undefined {
  const tc = step.metadata?.toolCall as { readonly name?: unknown } | undefined;
  return typeof tc?.name === "string" && tc.name.length > 0 ? tc.name : undefined;
}

/**
 * Classify an ACTION step for loop detection.
 *
 * A META / pseudo tool call is NON-PROGRESS by name (its contract says so),
 * regardless of how its observation reports. A non-meta action with NO
 * observation yet is treated as SUBSTANTIVE (the tool may still land evidence —
 * do not punish an in-flight call). Otherwise the linked observation decides
 * (failed / no-op → NON-PROGRESS).
 */
export function classifyActionStep(
  step: ReasoningStep,
  observation: ObservationLike | undefined,
): ProgressVerdict {
  const toolName = actionToolName(step);
  // The meta/pseudo rule lives in ONE place (classifyToolResult) — classify via
  // it so the two consumers cannot drift apart.
  if (isMetaTool(toolName) || isPseudoTool(toolName)) {
    return classifyToolResult(toolName, true, undefined);
  }
  if (observation === undefined) return SUBSTANTIVE;
  return classifyToolResult(toolName, observation.success ?? false, observation.content);
}

/**
 * Classify a run OUTPUT (terminal honesty — sibling failure mode 3). An empty /
 * no-op or give-up-shaped answer is NON-PROGRESS; a real answer is SUBSTANTIVE.
 * Provided for task 5.1's consumer wiring; not wired in this wave.
 */
export function classifyOutput(text: string | undefined): ProgressVerdict {
  if (contentIsNoOp(text)) return nonProgress("no-op");
  const t = (text ?? "").trim().toLowerCase();
  if (GIVE_UP_MARKERS.some((m) => t.includes(m))) return nonProgress("give-up");
  return SUBSTANTIVE;
}
