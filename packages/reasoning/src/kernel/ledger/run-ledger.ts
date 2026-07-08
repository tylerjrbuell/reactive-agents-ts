// File: src/kernel/ledger/run-ledger.ts
//
// RunLedger — the append-only event store (meta-loop spec §"ledger", the
// SECOND node of the one-directional DAG after RunContract):
//
//   RunContract → RunLedger → RunAssessment → (Control / Policy) → Actuators → Projector
//
// One typed, append-only record of everything that HAPPENED in a run — the
// substrate every later wave projects from (Assessment reads evidence deltas,
// the Projector renders outstanding work + handoffs, Control re-enters as
// ledger entries only). Arc-1's trace JSONL / EventBus / run_events / steps[]
// all eventually become PROJECTIONS of this store (spec ruling C1); that
// convergence is deferred (see C1b in the plan). This module is the spine.
//
// DAG law: entries are FACTS. `appendEntry` is pure — it returns a NEW ledger
// and never mutates the input; prior entries keep their object identity. `seq`
// is a dense, monotonic, append-assigned index; there are no back-edges and no
// in-place mutation. Compaction (C4) is re-projection, recorded as a NEW
// `compaction-marker` entry — never a rewrite of history.
//
// The ledger is stored on `KernelState.ledger` as a plain readonly array of
// plain-data entries (no class instances, no methods) so the durable
// kernel-codec round-trips it automatically for crash-resume. Query + append
// live as pure FREE functions here (not methods) to honor that plain-data
// contract and the codebase's readonly-immutable state convention.

import type { PostCondition } from "../capabilities/verify/post-conditions.js";

// ─── Entry kinds ───────────────────────────────────────────────────────────────

/** The twelve fact families the ledger can record (meta-loop spec §"ledger"). */
export type LedgerEntryKind =
  | "tool-invocation"
  | "tool-result"
  | "artifact"
  | "requirement"
  | "claim"
  | "verdict"
  | "harness-signal"
  | "handoff"
  | "contract-amended"
  | "compaction-marker"
  | "checkpoint-marker"
  | "deliverable-commit";

/** Fields carried by EVERY entry. `seq` is assigned by {@link appendEntry}. */
interface LedgerEntryBase {
  /** Dense, monotonic, append-assigned index (the entry's stable address). */
  readonly seq: number;
  /** The run iteration this fact was recorded at (advisory correlation). */
  readonly iteration: number;
  readonly kind: LedgerEntryKind;
}

/** A tool call was issued (grown from an `action` step; enriched by C2). */
export interface ToolInvocationEntry extends LedgerEntryBase {
  readonly kind: "tool-invocation";
  readonly toolName: string;
  readonly args?: Readonly<Record<string, unknown>>;
  readonly toolCallId?: string;
  /** The originating ReasoningStep id, so steps ⇄ ledger stay cross-referable. */
  readonly stepId?: string;
}

/** A tool returned (grown from an `observation` step). */
export interface ToolResultEntry extends LedgerEntryBase {
  readonly kind: "tool-result";
  readonly toolName?: string;
  readonly toolCallId?: string;
  readonly success: boolean;
  /** A bounded preview of the result content (full content lives on steps/refs). */
  readonly preview: string;
  /** Scratchpad ref key when the result was auto-stored (`_tool_result_*`). */
  readonly storedKey?: string;
  /** Distilled key fact (from step metadata.extractedFact). */
  readonly extractedFact?: string;
  readonly stepId?: string;
}

/**
 * A concrete deliverable was produced. Typed NOW; populated for real by C2
 * (tool registry `produces` + path extraction). Until then the emit point
 * exists but no production caller mints these — the field shape is the contract
 * C2 fills in.
 */
export interface ArtifactEntry extends LedgerEntryBase {
  readonly kind: "artifact";
  readonly path: string;
  readonly op: "write" | "append" | "delete" | "unknown";
  readonly digest?: string;
  readonly toolCallId?: string;
}

/** Lifecycle of a contract requirement (declared → satisfied|blocked). */
export type RequirementStatus = "declared" | "satisfied" | "blocked";
export interface RequirementEntry extends LedgerEntryBase {
  readonly kind: "requirement";
  readonly requirementId: string;
  readonly status: RequirementStatus;
  /** Ledger ref (e.g. seq or storedKey) of the evidence that satisfied it. */
  readonly evidenceRef?: string;
  readonly reason?: string;
}

/**
 * An empirical claim the model asserted (extracted by evidence-grounding).
 * Previously extracted and DISCARDED (audit 01-F2); now a first-class fact.
 */
export interface ClaimEntry extends LedgerEntryBase {
  readonly kind: "claim";
  readonly text: string;
  readonly value?: number;
  /** Whether the claim's magnitude was found in the tool-observation corpus. */
  readonly grounded?: boolean;
  readonly sourceStepId?: string;
}

/**
 * A verification verdict. Previously recomputed and DISCARDED at both gates
 * (audit 01); now persisted so the Assessment + receipt read it directly.
 */
export interface VerdictEntry extends LedgerEntryBase {
  readonly kind: "verdict";
  readonly gate: "per-step" | "in-loop" | "terminal";
  readonly verified: boolean;
  readonly reason?: string;
  /** How the run terminated, when this is a terminal verdict. */
  readonly terminatedBy?: string;
  /** Unmet post-conditions (deterministic side), when known. */
  readonly unmet?: readonly PostCondition[];
}

/** A harness-injected control signal (guard, redirect, terminal-gate decision). */
export interface HarnessSignalEntry extends LedgerEntryBase {
  readonly kind: "harness-signal";
  readonly signal: string;
  readonly detail?: string;
  readonly stepId?: string;
}

/**
 * A strategy switch carried context forward. Typed NOW; RENDERED by the
 * Projector in Wave D (audit 03-F5 — carried context currently never renders).
 */
export interface HandoffEntry extends LedgerEntryBase {
  readonly kind: "handoff";
  readonly from: string;
  readonly to: string;
  readonly summary: string;
}

/** A ledger-recorded mid-run contract amendment (the frozen-contract seam). */
export interface ContractAmendedEntry extends LedgerEntryBase {
  readonly kind: "contract-amended";
  readonly requirementId: string;
  readonly reason: string;
}

/**
 * A compaction happened. Carries the ENUMERATION of dropped refs (audit 03-F4:
 * no more "summarized" lies) so C4's protected-class + resolvable-ref
 * invariants are checkable.
 */
export interface CompactionMarkerEntry extends LedgerEntryBase {
  readonly kind: "compaction-marker";
  readonly droppedRefs: readonly string[];
  readonly reason?: string;
}

/** A durable checkpoint boundary (correlates the ledger to a persisted state). */
export interface CheckpointMarkerEntry extends LedgerEntryBase {
  readonly kind: "checkpoint-marker";
  readonly checkpointId?: string;
  readonly label?: string;
}

/** A deliverable was committed as the run's output (provenance at commit). */
export interface DeliverableCommitEntry extends LedgerEntryBase {
  readonly kind: "deliverable-commit";
  /** Path or requirement id of the committed deliverable. */
  readonly ref: string;
  readonly digest?: string;
}

/** The append-only entry union. */
export type LedgerEntry =
  | ToolInvocationEntry
  | ToolResultEntry
  | ArtifactEntry
  | RequirementEntry
  | ClaimEntry
  | VerdictEntry
  | HarnessSignalEntry
  | HandoffEntry
  | ContractAmendedEntry
  | CompactionMarkerEntry
  | CheckpointMarkerEntry
  | DeliverableCommitEntry;

/** The ledger IS a plain readonly array of facts — codec-round-trippable. */
export type RunLedger = readonly LedgerEntry[];

/** An entry as supplied to `appendEntry` — everything except the assigned `seq`. */
export type LedgerEntryInput = LedgerEntry extends infer T
  ? T extends LedgerEntry
    ? Omit<T, "seq">
    : never
  : never;

// ─── Append (pure, immutable) ───────────────────────────────────────────────────

/**
 * Append one fact, returning a NEW ledger with `seq` assigned. Pure — the input
 * ledger is never mutated; prior entries keep their identity (DAG law).
 * `undefined` is treated as an empty ledger (state-field convention).
 */
export function appendEntry(ledger: RunLedger | undefined, entry: LedgerEntryInput): RunLedger {
  const base = ledger ?? [];
  const withSeq = { ...entry, seq: base.length } as LedgerEntry;
  return [...base, withSeq];
}

/** Append several facts in one shot, assigning consecutive seqs. */
export function appendEntries(
  ledger: RunLedger | undefined,
  entries: readonly LedgerEntryInput[],
): RunLedger {
  let out = ledger ?? [];
  for (const e of entries) out = appendEntry(out, e);
  return out;
}

// ─── Query (pure, typed) ────────────────────────────────────────────────────────

/** All entries of a kind, narrowed to the matching variant. */
export function entriesOfKind<K extends LedgerEntryKind>(
  ledger: RunLedger | undefined,
  kind: K,
): ReadonlyArray<Extract<LedgerEntry, { kind: K }>> {
  return (ledger ?? []).filter(
    (e): e is Extract<LedgerEntry, { kind: K }> => e.kind === kind,
  );
}

/** The seq the NEXT appended entry will receive (== current length). */
export function nextSeq(ledger: RunLedger | undefined): number {
  return (ledger ?? []).length;
}

/** Total entry count. */
export function ledgerSize(ledger: RunLedger | undefined): number {
  return (ledger ?? []).length;
}
