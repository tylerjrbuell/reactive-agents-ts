/**
 * Decision rationale — structured "why" capture for any agent decision.
 *
 * The type lives in `@reactive-agents/core/src/types/rationale.ts` so trace,
 * tools, reasoning, and runtime can share the shape without cross-package
 * coupling. This module owns the validators.
 *
 * Attached as an optional field to:
 *   - ToolCallEvent (on tool-call-start)
 *   - AssumptionRecordedEvent
 *   - CuratorDecisionEvent
 *   - KernelStateSnapshotEvent (when terminatedBy set)
 *   - StrategySwitchedEvent / DecisionEvaluatedEvent (alongside free-text reason)
 *
 * v1 keeps this OPTIONAL everywhere it appears; models that don't emit it still
 * produce valid traces.
 */
import type { Rationale } from "@reactive-agents/core";
export type { Rationale } from "@reactive-agents/core";

const WHY_MAX = 280;
const REJECT_MAX = 160;

/**
 * Validate a candidate Rationale shape, throwing if invalid.
 * Returns the value (narrowed) when valid.
 */
export const validateRationale = (value: unknown): Rationale => {
  if (typeof value !== "object" || value === null) {
    throw new Error("Rationale: must be an object");
  }
  const v = value as Record<string, unknown>;

  if (typeof v.why !== "string" || v.why.length === 0) {
    throw new Error("Rationale: 'why' must be a non-empty string");
  }
  if (v.why.length > WHY_MAX) {
    throw new Error(`Rationale: 'why' must be ≤${WHY_MAX} chars (got ${v.why.length})`);
  }

  if (v.refs !== undefined) {
    if (!Array.isArray(v.refs) || v.refs.some((r) => typeof r !== "string")) {
      throw new Error("Rationale: 'refs' must be string[]");
    }
  }

  if (v.alternatives !== undefined) {
    if (!Array.isArray(v.alternatives)) {
      throw new Error("Rationale: 'alternatives' must be an array");
    }
    for (const alt of v.alternatives) {
      if (typeof alt !== "object" || alt === null) {
        throw new Error("Rationale: each alternative must be an object");
      }
      const a = alt as Record<string, unknown>;
      if (typeof a.option !== "string" || a.option.length === 0) {
        throw new Error("Rationale: alternative 'option' must be a non-empty string");
      }
      if (typeof a.rejectedBecause !== "string" || a.rejectedBecause.length === 0) {
        throw new Error("Rationale: alternative 'rejectedBecause' is required");
      }
      if (a.rejectedBecause.length > REJECT_MAX) {
        throw new Error(`Rationale: alternative 'rejectedBecause' must be ≤${REJECT_MAX} chars`);
      }
    }
  }

  if (v.confidence !== undefined) {
    if (typeof v.confidence !== "number" || v.confidence < 0 || v.confidence > 1) {
      throw new Error("Rationale: 'confidence' must be in [0,1]");
    }
  }

  return v as unknown as Rationale;
};

/** Type guard — returns true when value matches Rationale shape. */
export const isRationale = (value: unknown): value is Rationale => {
  try {
    validateRationale(value);
    return true;
  } catch {
    return false;
  }
};
