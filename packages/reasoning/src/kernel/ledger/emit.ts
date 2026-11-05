// File: src/kernel/ledger/emit.ts
//
// Discarded-evidence emitters (Wave C / task C1) — the concrete audit-01 win.
// These record facts the terminal path used to COMPUTE-AND-DISCARD:
//   - the exit VERDICT (recomputed and thrown away at both gates, audit 01)
//   - evidence-grounding CLAIMS (extracted and thrown away, audit 01-F2)
// onto the append-only RunLedger, so the Assessment + receipt + projector can
// read them instead of re-deriving from prose.
//
// Pure — returns a NEW ledger. Callers (arbitrator.applyTermination) append
// these BEFORE handing the ledger to `transitionState` via `patch.ledger`.

import type { ChecklistItemOp } from "@reactive-agents/core";
import type { RequirementKind } from "../contract/run-contract.js";
import type { ReasoningStep } from "../../types/index.js";
import {
  buildEvidenceCorpusFromSteps,
  classifyMeasurementClaims,
} from "../capabilities/verify/evidence-grounding.js";
import { appendEntries, appendEntry, entriesOfKind, type LedgerEntryInput, type RunLedger } from "./run-ledger.js";
import { stepToEntries } from "./step-projection.js";

/** One direct tool dispatch, distilled to the facts the canonical ledger pair needs. */
export interface ToolDispatchFact {
  readonly toolName: string;
  readonly args?: Readonly<Record<string, unknown>>;
  readonly toolCallId?: string;
  readonly iteration: number;
  /** The observation step the caller built — its tool-result projection is minted verbatim. */
  readonly obsStep: ReasoningStep;
}

/**
 * Record ONE direct tool dispatch as the canonical `tool-invocation` +
 * `tool-result` pair — byte-identical to what `transitionState` projects for
 * the kernel path, but exposed as a ledger-home emitter so the hand-rolled
 * strategies (plan-execute / blueprint) mint identical entries WITHOUT calling
 * the append primitives from outside `kernel/ledger/` (check-ledger-writes.sh).
 * The tool-result is derived from `obsStep` via `stepToEntries`, so preview /
 * storedKey / extractedFact match the projection exactly. Pure — returns a NEW
 * ledger; the primitive threads it into its config-supplied sink.
 */
export function recordToolDispatch(
  ledger: RunLedger | undefined,
  fact: ToolDispatchFact,
): RunLedger {
  return appendEntries(ledger, [
    {
      kind: "tool-invocation" as const,
      iteration: fact.iteration,
      toolName: fact.toolName,
      ...(fact.args !== undefined ? { args: fact.args } : {}),
      ...(fact.toolCallId !== undefined ? { toolCallId: fact.toolCallId } : {}),
    },
    ...stepToEntries(fact.obsStep, fact.iteration),
  ]);
}

/** The terminal verdict, distilled to the ledger's verdict shape. */
export interface TerminalVerdictFact {
  readonly verified: boolean;
  readonly terminatedBy?: string;
  readonly reason?: string;
  readonly iteration: number;
  /** Spec §3 — authority class of the terminating actor. */
  readonly authorityClass?: "deterministic" | "model-grade" | "lexical";
  /** Spec §1a — `"none"` for a contractless lexical exit (no goal evidence). */
  readonly evidence?: "none";
}

/**
 * Record the terminal verdict — the exit decision that the gates surfaced only
 * as steering guidance and otherwise discarded (audit 01). One `verdict` fact,
 * `gate: "terminal"`.
 */
export function recordTerminalVerdict(
  ledger: RunLedger | undefined,
  fact: TerminalVerdictFact,
): RunLedger {
  const withVerdict = appendEntry(ledger, {
    kind: "verdict",
    iteration: fact.iteration,
    gate: "terminal",
    verified: fact.verified,
    ...(fact.terminatedBy !== undefined ? { terminatedBy: fact.terminatedBy } : {}),
    ...(fact.reason !== undefined ? { reason: fact.reason } : {}),
    ...(fact.authorityClass !== undefined ? { authorityClass: fact.authorityClass } : {}),
    ...(fact.evidence !== undefined ? { evidence: fact.evidence } : {}),
  });
  // The `answer` floor requirement is satisfied exactly when the terminal gate
  // ACCEPTS a final answer (verified exit; an abstention is not an answer).
  // assess() cannot verify it mid-run, so this is its only satisfaction writer.
  if (!fact.verified || fact.terminatedBy === "abstained") return withVerdict;
  if (latestRequirementStatus(withVerdict).get(ANSWER_REQUIREMENT_ID) !== "declared") return withVerdict;
  return recordRequirementTransitions(withVerdict, [ANSWER_REQUIREMENT_ID], [], fact.iteration);
}

/** Id of the always-present question-answered floor requirement (run-contract). */
const ANSWER_REQUIREMENT_ID = "answer";

/**
 * Record a compaction as a `compaction-marker` fact (C4, audit 03-F4). The
 * dropped-ref enumeration turns the old "summarized" lie into a checkable
 * record: every ref here remains resolvable in the store (recallable refs also
 * via the `recall` meta-tool). No-op when nothing was dropped.
 *
 * De-duped against the most recent `compaction-marker`: because compaction
 * re-runs every over-budget iteration, an identical dropped-ref set would
 * otherwise append a redundant marker each turn. Only a CHANGED set (or the
 * first marker) is recorded — the ledger stays a log of distinct compactions.
 */
export function recordCompactionMarker(
  ledger: RunLedger | undefined,
  droppedRefs: readonly string[],
  iteration: number,
  reason?: string,
): RunLedger {
  if (droppedRefs.length === 0) return ledger ?? [];
  const base = ledger ?? [];
  const lastMarker = [...base].reverse().find((e) => e.kind === "compaction-marker");
  if (lastMarker && lastMarker.kind === "compaction-marker") {
    const prev = lastMarker.droppedRefs;
    if (prev.length === droppedRefs.length && prev.every((r, i) => r === droppedRefs[i])) {
      return base;
    }
  }
  return appendEntry(base, {
    kind: "compaction-marker",
    iteration,
    droppedRefs: [...droppedRefs],
    ...(reason !== undefined ? { reason } : {}),
  });
}

/**
 * Record which tool-result refs rendered as `preview+ref` this iteration
 * (FM-17 layer 1).
 *
 * De-dupe key is `(iteration, refs)`, NOT `refs` alone (finding I4). Keying on
 * refs alone made this emitter silently drop an iteration whose truncated set
 * happened to be byte-identical to the previous one — a pure-thought turn, or
 * the same still-too-large ref re-rendered. `assess()` reads "no entry at
 * iteration N" as "the model saw everything that turn" and resets the stall run,
 * so the very condition the fact exists to track erased itself the moment it
 * became STABLE. A repeated render WITHIN one iteration is still a true
 * duplicate and still no-ops.
 */
export function recordResultTruncation(
  ledger: RunLedger | undefined,
  truncatedRefs: readonly string[],
  iteration: number,
): RunLedger {
  if (truncatedRefs.length === 0) return ledger ?? [];
  const base = ledger ?? [];
  const last = [...base].reverse().find((e) => e.kind === "result-truncated");
  if (last && last.kind === "result-truncated" && last.iteration === iteration) {
    const prev = last.truncatedRefs;
    if (prev.length === truncatedRefs.length && prev.every((r, i) => r === truncatedRefs[i])) {
      return base;
    }
  }
  return appendEntry(base, {
    kind: "result-truncated",
    iteration,
    truncatedRefs: [...truncatedRefs],
  });
}

/**
 * Record a compaction that ran but could NOT shrink the window — everything in
 * the thread was a protected class (C4 shrink self-check). A `harness-signal`
 * fact so the run is never silently stuck at the window ceiling. De-duped so a
 * persistent no-shrink condition records once, not every iteration.
 */
export function recordCompactionNoShrink(
  ledger: RunLedger | undefined,
  iteration: number,
): RunLedger {
  const base = ledger ?? [];
  const last = [...base].reverse().find(
    (e) => e.kind === "harness-signal" && e.signal === "compaction-no-shrink",
  );
  if (last) return base;
  return appendEntry(base, {
    kind: "harness-signal",
    iteration,
    signal: "compaction-no-shrink",
    detail: "compaction attempted but window did not shrink (all entries protected)",
  });
}

/**
 * Record a mid-run adaptive-harness recompile (Wave G / G1). The policy compiler
 * re-derived the HarnessPlan from the live RunAssessment (deepen on repeated
 * failure / stall, lean on a clean trajectory); this logs WHY as a queryable
 * ledger fact. Keeps the append primitive in the ledger home so
 * check-ledger-writes.sh holds.
 */
export function recordHarnessRecompiled(
  ledger: RunLedger | undefined,
  iteration: number,
  detail: string,
): RunLedger {
  return appendEntry(ledger ?? [], {
    kind: "harness-signal",
    iteration,
    signal: "harness-recompiled",
    detail,
  });
}

/**
 * Record a strategy switch's carried context as a typed ledger fact. The
 * standing frame renders it (standing-frame.ts) and compaction protects it
 * (compaction.ts) — replaces string-folding the handoff into priorContext.
 */
export function recordHandoff(
  ledger: RunLedger | undefined,
  handoff: {
    readonly from: string;
    readonly to: string;
    readonly summary: string;
    /** Protocol strikes to carry across the switch (omitted when 0). */
    readonly protocolStrikes?: number;
  },
  iteration: number,
): RunLedger {
  return appendEntry(ledger, {
    kind: "handoff",
    iteration,
    from: handoff.from,
    to: handoff.to,
    summary: handoff.summary,
    ...(handoff.protocolStrikes !== undefined && handoff.protocolStrikes > 0
      ? { protocolStrikes: handoff.protocolStrikes }
      : {}),
  });
}

/**
 * Record the empirical measurement claims asserted in the final output, each
 * classified (grounded|not) against the tool-observation corpus built from the
 * run's steps. Previously extracted by the fabrication guard and discarded
 * (audit 01-F2, evidence-grounding.ts). No-op when the output carries no claims.
 */
export function recordEvidenceClaims(
  ledger: RunLedger | undefined,
  output: string | null | undefined,
  steps: readonly ReasoningStep[],
  scratchpad: ReadonlyMap<string, string> | undefined,
  iteration: number,
  tolerance = 0.01,
): RunLedger {
  if (typeof output !== "string" || output.trim().length === 0) return ledger ?? [];
  const corpus = buildEvidenceCorpusFromSteps(steps, scratchpad);
  const claims = classifyMeasurementClaims(output, corpus, tolerance);
  if (claims.length === 0) return ledger ?? [];
  return appendEntries(
    ledger,
    claims.map((c) => ({
      kind: "claim" as const,
      iteration,
      text: c.phrase,
      value: c.value,
      grounded: c.grounded,
    })),
  );
}

// ─── Requirement lifecycle (B7 / meta-loop §3b #39) ──────────────────────────
//
// The RunContract's requirement lifecycle (declared → satisfied|blocked) is the
// FIRST-node fact the meta-loop's two live readers wait on:
//   - assess.ts:207 (`entriesOfKind(ledger, "requirement")` → satisfiedIds/blockedIds)
//   - standing-frame.ts:193 (`satisfiedRequirementIds` → the outstanding-goal frame)
// Both saw `[]` until now (run-ledger.ts:96 declared the kind with zero writers),
// so the lifecycle was fiction. These two emitters are the ONLY writers: DECLARED
// at contract-compile (runner), SATISFIED/BLOCKED at the assess gate (iterate-pass).
//
// REUSE, DO NOT FORK. Satisfaction is NOT recomputed here — assess() (kernel/
// assessment/assess.ts) is the single satisfaction authority and is already
// entity-aware for entity-carrying conditions (ArtifactProduced matches by PATH
// via pathMatches, so a write to a DIFFERENT path does not satisfy a specific
// requirement). This emitter only PERSISTS the ids assess() partitions, so the
// entity-keying (#39's false-positive kill) rides the one authority instead of a
// forked copy. Per-entity gating of GENERIC tool-coverage requirements (binding
// `file-read` to a specific arg via `cardinality:"per-entity"`) is NOT closed
// here: TaskRequirement/RequirementSpec carry no entity/cardinality field, so
// there is no per-entity tool requirement to key — that needs a new condition +
// tool-metadata threading (out of B7's boundary).

/** A requirement id (+ optional self-description), what a `declared` entry carries. */
export interface RequirementRef {
  readonly id: string;
  /** Human description, copied onto the `declared` entry. */
  readonly description?: string;
  /** Requirement family, copied onto the `declared` entry as `requirementKind`. */
  readonly kind?: RequirementKind;
}

/**
 * Latest recorded status per requirement id (append-only ⇒ last write wins).
 * Scoped to the run's OWN pass: facts absorbed from sibling passes (sub-agents,
 * `pass`-tagged by mergePassLedger) reuse ids like `answer` and must never
 * shadow the root's status.
 */
function latestRequirementStatus(ledger: RunLedger | undefined): ReadonlyMap<string, string> {
  const latest = new Map<string, string>();
  for (const e of entriesOfKind(ledger, "requirement")) if (e.pass === undefined) latest.set(e.requirementId, e.status);
  return latest;
}

/**
 * DECLARED — mint one `requirement` entry (status `declared`) per contract
 * requirement that has never been recorded. Called ONCE at contract-compile
 * (runner), but idempotent: a requirement already present in the ledger (any
 * status) is skipped, so a replay/resume never double-declares. No-op when every
 * requirement is already recorded. Pure — returns a NEW ledger.
 */
export function recordRequirementsDeclared(
  ledger: RunLedger | undefined,
  requirements: readonly RequirementRef[],
  iteration: number,
): RunLedger {
  const seen = latestRequirementStatus(ledger);
  const fresh = requirements.filter((r) => !seen.has(r.id));
  if (fresh.length === 0) return ledger ?? [];
  return appendEntries(
    ledger,
    fresh.map((r) => ({
      kind: "requirement" as const,
      iteration,
      requirementId: r.id,
      status: "declared" as const,
      ...(r.description !== undefined ? { description: r.description } : {}),
      ...(r.kind !== undefined ? { requirementKind: r.kind } : {}),
    })),
  );
}

/**
 * SATISFIED/BLOCKED — mint the lifecycle TRANSITION for each requirement id that
 * assess() has just partitioned as satisfied or blocked and that does not yet
 * carry that terminal status in the ledger. Called every iteration at the assess
 * gate (iterate-pass); idempotent, so a persistently-satisfied requirement is
 * recorded once, not per turn. `blocked` wins over `satisfied` if an id is (only
 * transiently) in both. Pure — returns a NEW ledger. No-op when nothing changed.
 */
export function recordRequirementTransitions(
  ledger: RunLedger | undefined,
  satisfiedIds: readonly string[],
  blockedIds: readonly string[],
  iteration: number,
): RunLedger {
  const latest = latestRequirementStatus(ledger);
  const additions: Array<{
    readonly kind: "requirement";
    readonly iteration: number;
    readonly requirementId: string;
    readonly status: "satisfied" | "blocked";
  }> = [];
  const blocked = new Set(blockedIds);
  for (const id of blocked) {
    if (latest.get(id) !== "blocked") {
      additions.push({ kind: "requirement", iteration, requirementId: id, status: "blocked" });
    }
  }
  for (const id of satisfiedIds) {
    if (blocked.has(id)) continue;
    if (latest.get(id) !== "satisfied") {
      additions.push({ kind: "requirement", iteration, requirementId: id, status: "satisfied" });
    }
  }
  if (additions.length === 0) return ledger ?? [];
  return appendEntries(ledger, additions);
}

/** One advisory checklist change to record. */
export interface ChecklistItemFact {
  readonly iteration: number;
  readonly change: ChecklistItemOp;
  readonly toolCallId?: string;
  /** `"plan"` for harness-derived plan rows; omit for model `todo` facts. */
  readonly origin?: "plan";
}

/**
 * Record advisory checklist changes (the `todo` tool's facts) as `checklist-item`
 * entries with dense, consecutive seqs. No-op (same ledger identity) for an empty
 * batch. Pure — returns a NEW ledger.
 */
export function recordChecklistItems(
  ledger: RunLedger | undefined,
  facts: readonly ChecklistItemFact[],
): RunLedger {
  if (facts.length === 0) return ledger ?? [];
  return appendEntries(
    ledger,
    facts.map((f) => ({
      kind: "checklist-item" as const,
      iteration: f.iteration,
      change: f.change,
      ...(f.toolCallId !== undefined ? { toolCallId: f.toolCallId } : {}),
      ...(f.origin !== undefined ? { origin: f.origin } : {}),
    })),
  );
}

/**
 * Seed a round's pre-derived facts (artifact entries, gather-dedup signals)
 * onto the ledger. Returns the SAME ledger reference when `inputs` is empty so
 * callers can detect "nothing added" by identity. Act's round exits seed
 * through here (D-2026-10-28-ACT-EXIT) rather than calling the append
 * primitives from outside the ledger home.
 */
export function seedRoundFacts(
  ledger: RunLedger | undefined,
  inputs: readonly LedgerEntryInput[],
): RunLedger | undefined {
  return inputs.length > 0 ? appendEntries(ledger, inputs) : ledger;
}
