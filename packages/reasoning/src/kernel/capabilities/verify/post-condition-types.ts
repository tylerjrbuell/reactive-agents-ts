// File: src/kernel/capabilities/verify/post-condition-types.ts
//
// Leaf module for the PostCondition union — extracted from post-conditions.ts
// so run-ledger.ts (which needs the type) doesn't import the module that
// itself imports run-ledger.ts (entriesOfKind, RunLedger). No other imports
// here; keep it that way.

/** A tool that must have been called successfully at least once. */
export interface ToolCalledCondition {
  readonly kind: "ToolCalled";
  readonly tool: string;
}

/**
 * A file artifact that must have been produced — judged from a successful
 * write observation in the ledger whose originating action named a matching
 * path. NOT a real-fs check (per DBC: ledger-only).
 */
export interface ArtifactProducedCondition {
  readonly kind: "ArtifactProduced";
  readonly path: string;
}

/** The assembled output must contain this literal substring. */
export interface OutputContainsCondition {
  readonly kind: "OutputContains";
  readonly pattern: string;
}

/**
 * The run's side-effect must have LANDED — for a mutation task (create/send/
 * delete a note/email/event/…) whose deliverable is NOT a local file, so no
 * `ArtifactProduced` disk-check applies. Met iff the run's LATEST substantive
 * (non-meta, non-pseudo) tool observation SUCCEEDED. This closes the
 * generic-CLI blind spot: `ToolCalled(gws-cli)` is satisfied by a successful
 * `schema` READ while the `create` MUTATION failed — the tool name can't tell a
 * read from a write, so a failed mutation read as done and shipped a fabricated
 * "note created". Grounding on the terminal observation's success recovers the
 * ground truth the tool-name check throws away.
 */
export interface SideEffectLandedCondition {
  readonly kind: "SideEffectLanded";
}

export type PostCondition =
  | ToolCalledCondition
  | ArtifactProducedCondition
  | OutputContainsCondition
  | SideEffectLandedCondition;
