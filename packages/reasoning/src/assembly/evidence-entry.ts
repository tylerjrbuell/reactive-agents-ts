// File: src/assembly/evidence-entry.ts
//
// EvidenceEntry — ONE typed facet for a piece of gathered evidence (Wave C /
// task C3, audit 03-#14).
//
// Before this, a single tool result was represented THREE different ways
// depending on where you looked:
//   1. scratchpad `_tool_result_*`  — a (storedKey → jsonStr) map entry plus the
//      step's `metadata.storedKey` / `metadata.extractedFact` (types/step.ts).
//   2. `ResultStore` refs           — a StoredResult {ref, value} rendered into
//      `full` (materialize) / `preview` on demand (assembly/result-store.ts).
//   3. `from_step` values           — a PlanStep's `result` (compressed preview)
//      vs `fullResult` (whole payload) spliced by the from_step resolver.
//
// EvidenceEntry unifies them: full content, a bounded preview, a distilled
// extracted fact, and the RECALLABLE ref/key that points back at it. The field
// names `storedKey` and `extractedFact` are the SAME ones on
// StepMetadataSchema (types/step.ts) — this facet reuses them rather than
// inventing parallel fields, so the ledger's `tool-result` entry (which already
// carries preview/storedKey/extractedFact) is literally a projection of an
// EvidenceEntry.
//
// Pure — no Effect, no state, no I/O.

import type { ReasoningStep } from "../types/index.js";
import type { ResultStore } from "./result-store.js";
import { isRecallableRef } from "./ref-grammar.js";

/**
 * A single piece of gathered evidence, in ONE shape regardless of which of the
 * three legacy representations it came from.
 */
export interface EvidenceEntry {
  /** The full rendered content of the evidence (may be large). */
  readonly full: string;
  /** A bounded, prompt-safe preview of {@link full}. */
  readonly preview: string;
  /** Distilled key fact — reuses `StepMetadata.extractedFact` (types/step.ts). */
  readonly extractedFact?: string;
  /**
   * The RECALLABLE ref/key that resolves back to {@link full} — reuses
   * `StepMetadata.storedKey` (types/step.ts). Present only when the evidence is
   * stored under a recallable (scratchpad) key; absent for inline/never-stored
   * evidence so no caller can mint a dead recall pointer.
   */
  readonly storedKey?: string;
}

/** Metadata shape read off a step (subset of StepMetadataSchema, no `any`). */
interface StepEvidenceMeta {
  readonly storedKey?: string;
  readonly extractedFact?: string;
}

/**
 * Rep #1/#3 (scratchpad `_tool_result_*` + step-carried facts): build an
 * EvidenceEntry from a ReasoningStep. `full` is the step content (or the
 * supplied resolved full text when the content is a compressed preview);
 * `preview` is a bounded head. Reuses `metadata.storedKey` / `extractedFact`.
 */
export function evidenceFromStep(
  step: Pick<ReasoningStep, "content" | "metadata">,
  previewMax: number,
  resolvedFull?: string,
): EvidenceEntry {
  const meta = step.metadata as StepEvidenceMeta | undefined;
  const full = resolvedFull ?? step.content;
  const storedKey =
    typeof meta?.storedKey === "string" && isRecallableRef(meta.storedKey)
      ? meta.storedKey
      : undefined;
  const extractedFact =
    typeof meta?.extractedFact === "string" ? meta.extractedFact : undefined;
  return {
    full,
    preview: step.content.slice(0, previewMax),
    ...(extractedFact !== undefined ? { extractedFact } : {}),
    ...(storedKey !== undefined ? { storedKey } : {}),
  };
}

/**
 * Rep #2 (`ResultStore` ref): build an EvidenceEntry from a stored result.
 * `full` = materialized value; `preview` = the store's content-aware bounded
 * preview. `storedKey` is set ONLY when the ref is recallable — a minted
 * content-hash `res_*` ref carries no storedKey (it is not recall-resolvable).
 */
export function evidenceFromStored(
  store: ResultStore,
  ref: string,
  previewBudget: number,
): EvidenceEntry {
  return {
    full: store.materialize(ref, "bullets"),
    preview: store.preview(ref, previewBudget),
    ...(isRecallableRef(ref) ? { storedKey: ref } : {}),
  };
}

/**
 * Rep #3 (`from_step` value): build an EvidenceEntry from a plan step's result.
 * `full` prefers the uncompressed `fullResult`; `preview` is the (compressed)
 * `result`. from_step values are spliced by reference, not recalled, so there is
 * no storedKey.
 */
export function evidenceFromPlanResult(
  result: string,
  fullResult?: string,
): EvidenceEntry {
  return {
    full: fullResult ?? result,
    preview: result,
  };
}
