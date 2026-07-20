// File: src/kernel/assessment/assess.ts
//
// RunAssessment — the progress estimator (the harness "sense/perceive" node,
// meta-loop spec §2). The THIRD node of the one-directional meta-loop DAG:
//
//   RunContract → RunLedger → RunAssessment → (Control / Policy) → Actuators → Projector
//
// One PURE function, recomputed each iteration, that answers *where does this run
// stand?* — which requirements are satisfied vs outstanding, which deliverables
// are produced vs missing, how much NEW evidence this iteration produced, what
// phase the run is in, whether budget-vs-work is on-pace, and the windowed health
// signals future guards read. This module is the ONE HOME for run-progress
// counters (spec §2: "None [no guard] may hold private counters"). Wave E2
// migrates the 23 scattered guard counters onto these fields; E1 defines the
// shape + computes what the ledger already supports.
//
// DAG law: assess() is a pure READ of (contract × ledger × budget). It never
// mutates, never reads loop-control state beyond its three inputs, never emits a
// control action or a ledger entry (that is E2/E3/F). No back-edges.
//
// REUSE, DO NOT FORK. Evidence identity reuses C3's `normalizeArgsHash`
// (assembly/gather-dedup.ts) — the SAME (tool, normalized-args) notion of "seen"
// the dedup index uses — so "new evidence" and "duplicate gather" agree by
// construction. Gathering-vs-mutating classification reuses C3's `isGatheringTool`.
// Requirement/deliverable satisfaction reads the ledger via the C1/C2 queries
// (`entriesOfKind`, `artifacts`) against the contract's PostConditions.

import { isGatheringTool, normalizeArgsHash } from "../../assembly/gather-dedup.js";
import type { PostCondition } from "../capabilities/verify/post-conditions.js";
import type { DeliverableSpec, RunContract, TaskRequirement } from "../contract/run-contract.js";
import { artifacts } from "../ledger/artifact-projection.js";
import { entriesOfKind, type RunLedger } from "../ledger/run-ledger.js";
import { META_TOOLS } from "../state/kernel-constants.js";

// ─── Output vocabulary ───────────────────────────────────────────────────────

/** The run-phase model (spec §2, D4's dynamic half). */
export type RunPhase = "orient" | "gather" | "execute" | "synthesize" | "verify";

/** Pace bands, escalating with budget burn while work remains (audit 05-#12). */
export type PaceBand = "green" | "economize" | "triage" | "terminal";

/** Requirement status partition — ids are the contract's stable requirement refs. */
export interface RequirementAssessment {
  readonly satisfied: readonly string[];
  readonly outstanding: readonly string[];
  readonly blocked: readonly string[];
}

/** A produced deliverable + its ledger provenance. */
export interface ArtifactRef {
  /** The owning deliverable id (mirrors the contract deliverable id). */
  readonly id: string;
  /** The written path, when the deliverable is a file. */
  readonly path?: string;
  /** The ledger seq of the producing artifact entry (provenance). */
  readonly seq?: number;
}

/** Deliverable truth — what the receipt reports as produced|missing. */
export interface DeliverableAssessment {
  readonly produced: readonly ArtifactRef[];
  readonly missing: readonly DeliverableSpec[];
}

/** Budget-vs-work pace (spec §2: pace is computed FROM outstanding × burnRatio). */
export interface PaceAssessment {
  /** Fraction of budget consumed (max of token/cost ratio; iteration fallback). */
  readonly burnRatio: number;
  readonly band: PaceBand;
}

/**
 * Windowed run-health — the fields future guards (E2) read instead of holding
 * private counters. E1 populates what the ledger already supports; the rest are
 * typed-and-computed-from-ledger now so E2 is a migration, not a schema change.
 */
export interface RunHealth {
  /** Failed tool-results within the health window. */
  readonly recentFailures: number;
  /** Trailing run of consecutive failed tool-results (most recent first). */
  readonly consecutiveFailures: number;
  /** Stall/loop/no-progress harness-signals within the window. */
  readonly stuckSignals: number;
  /** Iterations since the last substantive evidence (stall proximity; 0 = fresh). */
  readonly iterationsSinceEvidence: number;
  /**
   * Distinct normalized-args among the trailing streak of consecutive FAILED
   * tool-results that share the most-recent failure's tool (audit 02-#11). `> 1`
   * ⇒ the model is VARYING its arguments across those failures — it is EXPLORING
   * different fixes, not blindly repeating one bad call — so an arg-INSENSITIVE
   * "repeated identical failure" class (F3) would misfire. `0` when the most
   * recent result is not a failure. Reuses the SAME `normalizeArgsHash` identity
   * evidenceDelta / gather-dedup use, so "varying args" agrees by construction.
   * E2 (added to E1's assess) is the arg-normalized failure signal F3 reads.
   */
  readonly failureArgVariety: number;
}

/** The compiled perception of where the run stands, recomputed each iteration. */
export interface RunAssessment {
  readonly requirements: RequirementAssessment;
  readonly deliverables: DeliverableAssessment;
  /** NEW substantive evidence THIS iteration (the one progress currency). */
  readonly evidenceDelta: number;
  readonly phase: RunPhase;
  readonly pace: PaceAssessment;
  readonly health: RunHealth;
}

// ─── Budget input (the spec's `BudgetState`) ────────────────────────────────

/**
 * The budget input to assess() — the spec's `BudgetState`. Computed at the call
 * site from KernelState (iteration, maxIterations, tokens, cost, meta.budgetLimits).
 * Kept as a flat plain-data shape so assess() stays pure and synchronous.
 */
export interface BudgetState {
  readonly iteration: number;
  readonly maxIterations: number;
  readonly tokensUsed: number;
  readonly costUsd: number;
  readonly tokenLimit?: number;
  readonly costLimit?: number;
}

// ─── Tuning constants ────────────────────────────────────────────────────────

/** Pace-band burnRatio thresholds (spec §2). */
export const PACE_ECONOMIZE = 0.6;
export const PACE_TRIAGE = 0.8;
export const PACE_TERMINAL = 0.95;

/** Health lookback window in iterations (matches A2's windowed-veto N = 10). */
const HEALTH_WINDOW = 10;

/** Harness-signal substrings that denote a stuck/stall condition. */
const STUCK_SIGNAL_PATTERNS = ["stall", "loop", "no-progress", "stuck", "no-shrink"] as const;

// ─── Path matching (mirrors post-conditions writtenPathSatisfies) ────────────
//
// A written (ledger) path satisfies a derived TARGET path iff it equals the
// target or the target is a trailing PATH-SEGMENT suffix (a "/" boundary before
// it). Asymmetric on purpose: the derived target is the short relative side
// ("report.md", "dir/report.md"), the written path the long/absolute side. Kept
// local + minimal because post-conditions' helper is not exported and re-running
// verify() (which takes ReasoningStep[], not the ledger) is not applicable here.

function normalizePath(p: string): string {
  return p.trim().replace(/^\.\//, "");
}

function pathMatches(written: string, target: string): boolean {
  const w = normalizePath(written);
  const t = normalizePath(target);
  if (t.length === 0) return false;
  return w === t || w.endsWith(`/${t}`);
}

// ─── Evidence identity (reuses C3's normalized (tool, args) notion) ──────────

/** Stable identity of a tool-result = (toolName, normalized-args-hash). */
function resultIdentity(
  toolName: string,
  toolCallId: string | undefined,
  argsByCallId: ReadonlyMap<string, Readonly<Record<string, unknown>>>,
): string {
  const args = toolCallId ? argsByCallId.get(toolCallId) : undefined;
  return `${toolName} ${normalizeArgsHash(args)}`;
}

// ─── The estimator (pure) ────────────────────────────────────────────────────

/**
 * Perceive where the run stands. Pure fn(contract × ledger × budget). Same
 * inputs → same output (determinism is contractual — no Date, no randomness).
 */
export function assess(
  contract: RunContract,
  ledger: RunLedger,
  budget: BudgetState,
): RunAssessment {
  const invocations = entriesOfKind(ledger, "tool-invocation");
  const results = entriesOfKind(ledger, "tool-result");
  const artifactEntries = artifacts(ledger);
  const currentIter = budget.iteration;

  // Args recovery: join tool-result → tool-invocation by toolCallId so the
  // evidence identity can hash the SAME args the gather-dedup index does.
  const argsByCallId = new Map<string, Readonly<Record<string, unknown>>>();
  for (const inv of invocations) {
    if (inv.toolCallId && inv.args) argsByCallId.set(inv.toolCallId, inv.args);
  }

  // Tools called (successfully OR at all) — the ToolCalled satisfaction set.
  const invokedTools = new Set<string>();
  for (const inv of invocations) if (inv.toolName) invokedTools.add(inv.toolName);
  for (const r of results) if (r.success && r.toolName) invokedTools.add(r.toolName);

  // Explicit requirement lifecycle entries (C1) — authoritative when present.
  const requirementEntries = entriesOfKind(ledger, "requirement");
  const satisfiedIds = new Set<string>();
  const blockedIds = new Set<string>();
  for (const e of requirementEntries) {
    if (e.status === "satisfied") satisfiedIds.add(e.requirementId);
    else if (e.status === "blocked") blockedIds.add(e.requirementId);
  }

  // ── Requirement satisfaction ──────────────────────────────────────────────
  const conditionMet = (cond: PostCondition): boolean => {
    switch (cond.kind) {
      case "ToolCalled":
        return invokedTools.has(cond.tool);
      case "ArtifactProduced":
        return artifactEntries.some((a) => pathMatches(a.path, cond.path));
      case "OutputContains":
        // The estimator has no output; only the terminal gate verifies this.
        return false;
    }
  };

  const satisfied: string[] = [];
  const outstanding: string[] = [];
  const blocked: string[] = [];
  const outstandingSet = new Set<string>();
  for (const r of contract.requirements) {
    if (blockedIds.has(r.id)) {
      blocked.push(r.id);
      continue;
    }
    const met = satisfiedIds.has(r.id) || (r.spec.condition !== undefined && conditionMet(r.spec.condition));
    if (met) satisfied.push(r.id);
    else {
      outstanding.push(r.id);
      outstandingSet.add(r.id);
    }
  }

  // ── Deliverable truth ─────────────────────────────────────────────────────
  const produced: ArtifactRef[] = [];
  const missing: DeliverableSpec[] = [];
  for (const d of contract.deliverables) {
    const m = d.matcher;
    if (m.kind === "ArtifactProduced") {
      const hit = artifactEntries.find((a) => pathMatches(a.path, m.path));
      if (hit) produced.push({ id: d.id, path: hit.path, seq: hit.seq });
      else missing.push(d);
    } else if (m.kind === "ToolCalled") {
      if (invokedTools.has(m.tool)) produced.push({ id: d.id });
      else missing.push(d);
    } else {
      // OutputContains — unverifiable mid-run (no output visible here).
      missing.push(d);
    }
  }

  // ── evidenceDelta — NEW substantive evidence THIS iteration ───────────────
  // Substantive = successful, non-meta tool-result. "New" = identity (reusing
  // C3's normalized (tool, args)) not seen in any EARLIER iteration.
  const substantive = (r: (typeof results)[number]): r is typeof r & { toolName: string } =>
    r.success && typeof r.toolName === "string" && !META_TOOLS.has(r.toolName);

  const priorIdentities = new Set<string>();
  for (const r of results) {
    if (r.iteration >= currentIter) continue;
    if (!substantive(r)) continue;
    priorIdentities.add(resultIdentity(r.toolName, r.toolCallId, argsByCallId));
  }
  const currentNew = new Set<string>();
  for (const r of results) {
    if (r.iteration !== currentIter) continue;
    if (!substantive(r)) continue;
    const id = resultIdentity(r.toolName, r.toolCallId, argsByCallId);
    if (!priorIdentities.has(id)) currentNew.add(id);
  }
  const evidenceDelta = currentNew.size;

  // ── Phase inference (contract progress + recent action mix) ────────────────
  const detRequirements = contract.requirements.filter(
    (r): r is TaskRequirement & { spec: { condition: PostCondition } } => r.spec.condition !== undefined,
  );
  const detOutstandingCount = detRequirements.filter((r) => outstandingSet.has(r.id)).length;

  // Is the run VERIFYING right now?
  //
  // A `terminal` verdict means the run reached the terminal gate. It is minted
  // only by the arbitrator's exit transitions (`done`/`failed`), so it cannot be
  // observed from inside the loop — it is kept here for post-loop/replay
  // assessments, and is NOT what makes the phase reachable.
  //
  // The live signal is the latest `in-loop` verdict: the completion-guard and
  // the abstention-legitimacy gate record whether a PROPOSED completion was
  // accepted. A rejection ⇒ the run is in verify/repair. An acceptance ⇒ it is
  // about to terminate, so it must NOT pin the phase to `verify`. Reading
  // `.verified` (not merely `.gate`) is what makes this distinction — before the
  // fix, gate presence alone decided, and the field was inert (wiring audit
  // 2026-07-09). `per-step` verdicts are excluded: they fire on ordinary tool
  // observations and would pin every run to `verify`.
  const gateVerdicts = entriesOfKind(ledger, "verdict").filter(
    (v) => v.gate === "terminal" || v.gate === "in-loop",
  );
  const latestGateVerdict = gateVerdicts[gateVerdicts.length - 1];
  const isVerifying =
    latestGateVerdict !== undefined &&
    (latestGateVerdict.gate === "terminal" || latestGateVerdict.verified === false);
  const substantiveInvocations = invocations.filter(
    (i): i is typeof i & { toolName: string } => typeof i.toolName === "string" && !META_TOOLS.has(i.toolName),
  );
  // "Recent action mix" (spec §2), read from the most recent substantive action:
  // a mutating (non-gathering) last action ⇒ the run is producing (execute); a
  // gathering last action ⇒ still collecting (gather).
  const lastSubstantive = substantiveInvocations[substantiveInvocations.length - 1];
  const lastIsMutating = lastSubstantive !== undefined && !isGatheringTool(lastSubstantive.toolName);
  const anyEvidence = substantiveInvocations.length > 0;

  const phase: RunPhase = isVerifying
    ? "verify"
    : detRequirements.length > 0 && detOutstandingCount === 0
      ? "synthesize"
      : lastIsMutating
        ? "execute"
        : anyEvidence
          ? "gather"
          : "orient";

  // ── Pace (budget burn coupled to remaining deterministic work) ─────────────
  const ratios: number[] = [];
  if (budget.tokenLimit !== undefined && budget.tokenLimit > 0) {
    ratios.push(budget.tokensUsed / budget.tokenLimit);
  }
  if (budget.costLimit !== undefined && budget.costLimit > 0) {
    ratios.push(budget.costUsd / budget.costLimit);
  }
  const burnRatio =
    ratios.length > 0
      ? Math.max(...ratios)
      : budget.maxIterations > 0
        ? budget.iteration / budget.maxIterations
        : 0;

  // The coupling (spec §2): budget pressure only escalates while deterministic
  // work remains. Zero deterministic outstanding → green regardless of burn
  // (the answer-floor self-critique requirement stays outstanding but does not
  // create pace pressure — it is not gather/produce work to economize toward).
  const band: PaceBand =
    detOutstandingCount === 0
      ? "green"
      : burnRatio >= PACE_TERMINAL
        ? "terminal"
        : burnRatio >= PACE_TRIAGE
          ? "triage"
          : burnRatio >= PACE_ECONOMIZE
            ? "economize"
            : "green";

  // ── Health (windowed) ─────────────────────────────────────────────────────
  const windowFloor = currentIter - HEALTH_WINDOW;
  const inWindow = (iter: number): boolean => iter > windowFloor && iter <= currentIter;

  let recentFailures = 0;
  for (const r of results) {
    if (inWindow(r.iteration) && r.success === false) recentFailures++;
  }
  // Consecutive failures — trailing streak over the most recent results.
  let consecutiveFailures = 0;
  for (let i = results.length - 1; i >= 0; i--) {
    const r = results[i];
    if (!r || r.success !== false) break;
    consecutiveFailures++;
  }

  const harnessSignals = entriesOfKind(ledger, "harness-signal");
  let stuckSignals = 0;
  for (const s of harnessSignals) {
    if (!inWindow(s.iteration)) continue;
    if (STUCK_SIGNAL_PATTERNS.some((p) => s.signal.toLowerCase().includes(p))) stuckSignals++;
  }

  // Arg-normalized failure identity (audit 02-#11 / F3). Walk the trailing
  // streak of consecutive FAILED results that share the most-recent failure's
  // tool; count DISTINCT normalized-args-hashes. >1 ⇒ varying args (exploring),
  // so an arg-insensitive "repeated identical failure" class would misfire.
  let failureArgVariety = 0;
  {
    const last = results[results.length - 1];
    if (last && last.success === false && typeof last.toolName === "string") {
      const streakTool = last.toolName;
      const argHashes = new Set<string>();
      for (let i = results.length - 1; i >= 0; i--) {
        const r = results[i];
        if (!r || r.success !== false || r.toolName !== streakTool) break;
        argHashes.add(resultIdentity(r.toolName, r.toolCallId, argsByCallId));
      }
      failureArgVariety = argHashes.size;
    }
  }

  // Stall proximity — iterations since the last substantive evidence.
  let lastEvidenceIter = -1;
  for (const r of results) {
    if (substantive(r) && r.iteration > lastEvidenceIter) lastEvidenceIter = r.iteration;
  }
  const iterationsSinceEvidence =
    lastEvidenceIter < 0 ? Math.max(0, currentIter) : Math.max(0, currentIter - lastEvidenceIter);

  return {
    requirements: { satisfied, outstanding, blocked },
    deliverables: { produced, missing },
    evidenceDelta,
    phase,
    pace: { burnRatio, band },
    health: {
      recentFailures,
      consecutiveFailures,
      stuckSignals,
      iterationsSinceEvidence,
      failureArgVariety,
    },
  };
}
