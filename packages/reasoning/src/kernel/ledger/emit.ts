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

import type { ReasoningStep } from "../../types/index.js";
import {
  buildEvidenceCorpusFromSteps,
  classifyMeasurementClaims,
} from "../capabilities/verify/evidence-grounding.js";
import { appendEntries, appendEntry, entriesOfKind, type RunLedger } from "./run-ledger.js";
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
  return appendEntry(ledger, {
    kind: "verdict",
    iteration: fact.iteration,
    gate: "terminal",
    verified: fact.verified,
    ...(fact.terminatedBy !== undefined ? { terminatedBy: fact.terminatedBy } : {}),
    ...(fact.reason !== undefined ? { reason: fact.reason } : {}),
    ...(fact.authorityClass !== undefined ? { authorityClass: fact.authorityClass } : {}),
    ...(fact.evidence !== undefined ? { evidence: fact.evidence } : {}),
  });
}

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

/** A requirement id + kind, the minimum a `declared` entry needs. */
export interface RequirementRef {
  readonly id: string;
}

/** Latest recorded status per requirement id (append-only ⇒ last write wins). */
function latestRequirementStatus(ledger: RunLedger | undefined): ReadonlyMap<string, string> {
  const latest = new Map<string, string>();
  for (const e of entriesOfKind(ledger, "requirement")) latest.set(e.requirementId, e.status);
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
