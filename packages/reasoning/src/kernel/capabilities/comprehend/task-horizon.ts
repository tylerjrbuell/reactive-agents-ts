/**
 * task-horizon.ts — Pre-execution horizon inference (the first "upward gear",
 * audit 04-#8).
 *
 * Answers a question none of the existing classifiers do: is this a SHORT task
 * (a few iterations of orient → act → answer) or a LONG one (a 40+ iteration
 * research / multi-phase build where guards must tolerate sustained gathering
 * and the synthesize phase must be protected from early-stop)?
 *
 * Today the harness governs iteration 2 of orientation and iteration 38 of a
 * long research run identically — the D4 disease from the 2026-07-08 sweep. The
 * horizon axis is the deterministic seed that later waves (RunAssessment pace
 * bands, the policy compiler's horizon-scaled guard profile) consume. It lives
 * here, in the canonical comprehend layer, so it is derived ONCE and threaded.
 *
 * Design: pure regex/keyword pass, NO LLM. Conservative — defaults to "short"
 * and only escalates to "long" on high-signal cues, so a run without decisive
 * long-horizon evidence is governed exactly as today.
 */

/** Estimated run horizon. Drives guard tolerance + phase protection downstream. */
export type TaskHorizon = "short" | "long";

export interface TaskHorizonClassification {
  readonly horizon: TaskHorizon;
  /** Why the classifier landed here — for telemetry + the contract-compiled trace. */
  readonly reason: string;
  /** Confidence in [0, 1]. "long" verdicts are only emitted on high-signal cues. */
  readonly confidence: number;
}

// ── Long-horizon cues ─────────────────────────────────────────────────────────

/** Explicit operator signal that the task is long-running. */
const EXPLICIT_LONG: readonly RegExp[] = [
  /\blong[-\s]?(?:horizon|task|running)\b/i,
  /\bthis\s+is\s+a\s+long\b/i,
  /\bmulti[-\s]?(?:hour|day|session)\b/i,
];

/** "Answer ALL SIX questions", "complete all 5 phases", "all seven steps". */
const ENUMERATED_MANY =
  /\ball\s+(?:six|seven|eight|nine|ten|\d{1,3})\s+(?:questions|phases|steps|parts|sections|deliverables|tasks)\b/i;

/** A numbered question series Q1..Qn — count the distinct question ids. */
const QUESTION_ID_RE = /\bQ\d+\b/gi;

/** An explicit multi-phase decomposition — count "Phase N" markers. */
const PHASE_MARKER_RE = /\bphase\s*\d+\b/gi;

/** Threshold for the enumerated-signal counts above. */
const MANY_THRESHOLD = 4;

function distinctCount(task: string, re: RegExp): number {
  const seen = new Set<string>();
  for (const m of task.matchAll(re)) seen.add(m[0].toLowerCase());
  return seen.size;
}

/**
 * Classify a task's horizon BEFORE the run. Decision order (first match wins):
 *  1. Explicit long-running phrasing → long (high confidence).
 *  2. "all N questions/phases/…" enumeration → long.
 *  3. ≥4 distinct Q-ids OR ≥4 distinct "Phase N" markers → long.
 *  4. Otherwise → short.
 */
export function classifyTaskHorizon(task: string): TaskHorizonClassification {
  const normalized = task.trim();
  if (normalized.length === 0) {
    return { horizon: "short", reason: "empty-task", confidence: 0.5 };
  }

  for (const pattern of EXPLICIT_LONG) {
    if (pattern.test(normalized)) {
      return {
        horizon: "long",
        reason: `explicit-long:${pattern.source.slice(0, 24)}`,
        confidence: 0.9,
      };
    }
  }

  if (ENUMERATED_MANY.test(normalized)) {
    return { horizon: "long", reason: "enumerated-many", confidence: 0.85 };
  }

  const questionCount = distinctCount(normalized, QUESTION_ID_RE);
  if (questionCount >= MANY_THRESHOLD) {
    return {
      horizon: "long",
      reason: `question-series:${questionCount}`,
      confidence: 0.8,
    };
  }

  const phaseCount = distinctCount(normalized, PHASE_MARKER_RE);
  if (phaseCount >= MANY_THRESHOLD) {
    return {
      horizon: "long",
      reason: `multi-phase:${phaseCount}`,
      confidence: 0.8,
    };
  }

  return { horizon: "short", reason: "default-short", confidence: 0.6 };
}

/** Convenience: the bare horizon label (the field threaded onto TaskClassification). */
export function classifyHorizon(task: string): TaskHorizon {
  return classifyTaskHorizon(task).horizon;
}
