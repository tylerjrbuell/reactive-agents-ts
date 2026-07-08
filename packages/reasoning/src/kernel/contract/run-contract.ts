// File: src/kernel/contract/run-contract.ts
//
// RunContract — the goal compiler (the harness "comprehend" node, meta-loop
// spec §1). The FIRST node of the one-directional meta-loop DAG:
//
//   RunContract → RunLedger → RunAssessment → (Control / Policy) → Actuators → Projector
//
// One typed object, compiled ONCE at run start and then FROZEN, that answers the
// single question every subsystem today re-derives independently from a prose
// string: *what does DONE mean for this run?* Later waves consume it — the
// terminal gate (check 2.5 = contract vs ledger), the progress estimator, pace
// bands, receipts (`deliverables[]`), the projector (renders outstanding items).
//
// GRAFT, DO NOT FORK. The requirement + deliverable specs are grafted directly
// onto the live PostCondition vocabulary (../capabilities/verify/post-conditions.ts:
// ToolCalled / ArtifactProduced / OutputContains) — already ledger-verified by
// the pure verify() gate. A requirement's deterministic side IS a PostCondition;
// B2's terminal gate verifies it with the existing verify(), unchanged.
//
// DAG law: this compiler reads TASK INPUTS ONLY (task prose, declared
// TaskContract, required tools, comprehend classification). It never reads
// runtime loop state — no back-edges. The single amendable seam is
// `amendContract`, wired in Phase 4b via an explicit ledger-recorded entry.

import type { TaskContract } from "@reactive-agents/core";
import { classifyTaskHorizon, type TaskHorizon } from "../capabilities/comprehend/task-horizon.js";
import {
  deriveDeliverablePaths,
  pickWritingTool,
} from "../capabilities/verify/derive-conditions.js";
import {
  artifactProduced,
  outputContains,
  toolCalled,
  type PostCondition,
} from "../capabilities/verify/post-conditions.js";

// ─── Vocabulary ──────────────────────────────────────────────────────────────

/** How strongly a requirement / deliverable can be verified (stakes-tiered). */
export type AcceptanceTier = "deterministic" | "checker" | "self-critique";

/** The four requirement families the contract can express. */
export type RequirementKind =
  | "question-answered"
  | "artifact-produced"
  | "constraint-held"
  | "tool-coverage";

/**
 * How a requirement is verified. `condition` is the GRAFT onto the live
 * PostCondition vocabulary — present when the requirement is deterministically
 * ledger-checkable (tool-coverage → ToolCalled, artifact-produced →
 * ArtifactProduced, an OutputContains question-section). Absent for the base
 * answer requirement, which only a checker / self-critique can judge.
 */
export interface RequirementSpec {
  /** Human/steering description of what must hold ("produce ./report.md"). */
  readonly description: string;
  /** The deterministic, ledger-checkable condition — a live PostCondition. */
  readonly condition?: PostCondition;
  /** Verification tier for this requirement. */
  readonly acceptance: AcceptanceTier;
}

/** One thing that must be true for the run to count as DONE. */
export interface TaskRequirement {
  /** Stable id — the ref B2's ledger + projector address this requirement by. */
  readonly id: string;
  readonly kind: RequirementKind;
  readonly spec: RequirementSpec;
  /** Relative importance for partial-credit scoring (higher = more load-bearing). */
  readonly weight: number;
}

/** A concrete producible output the receipt reports as produced|missing. */
export interface DeliverableSpec {
  /** Stable id (mirrors the owning requirement's id). */
  readonly id: string;
  readonly kind: "file" | "answer-section" | "structured-object";
  /** How to verify it was produced — a live PostCondition (graft). */
  readonly matcher: PostCondition;
  readonly acceptance: AcceptanceTier;
}

/** A hard boundary the run must not cross. */
export type Constraint =
  | { readonly kind: "forbidden-tool"; readonly tool: string }
  | { readonly kind: "output-format"; readonly format: string };

/** Stakes-tiered acceptance policy: deterministic checks > checker > self-critique. */
export interface AcceptancePolicy {
  /** Verification tiers, strongest first. */
  readonly tiers: readonly AcceptanceTier[];
  /** Stakes level — scales how strict acceptance is. */
  readonly stakes: "low" | "standard" | "high";
}

/** The compiled, frozen answer to "what does DONE mean for this run?". */
export interface RunContract {
  readonly requirements: readonly TaskRequirement[];
  readonly deliverables: readonly DeliverableSpec[];
  readonly constraints: readonly Constraint[];
  readonly horizon: TaskHorizon;
  readonly acceptance: AcceptancePolicy;
  /**
   * The deterministic floor — the union of every requirement's PostCondition —
   * so B2's terminal gate / the existing verify() can consume the contract's
   * checkable side directly without re-walking requirements.
   */
  readonly postConditions: readonly PostCondition[];
}

// ─── Compile options ─────────────────────────────────────────────────────────

export interface CompileRunContractOptions {
  /** Tools the dispatcher requires (the highest-confidence tool signal). */
  readonly requiredTools?: readonly string[];
  /**
   * The declared TaskContract when present (C2 ruling: RunContract absorbs and
   * extends TaskContract). Required tools are read from `.tools[required]`,
   * forbidden tools + output shape become constraints + deterministic
   * OutputContains requirements. Threaded from the runtime/bench layer — the
   * kernel does not receive TaskContract today, so this is a typed seam callers
   * populate when they have it.
   */
  readonly taskContract?: TaskContract;
  /** Override the derived horizon (else classifyTaskHorizon(task)). */
  readonly horizon?: TaskHorizon;
}

// ─── Freeze helpers ──────────────────────────────────────────────────────────

/** Deep-freeze the compiled contract so no consumer can mutate it post-compile. */
function freezeContract(contract: RunContract): RunContract {
  for (const r of contract.requirements) {
    Object.freeze(r);
    Object.freeze(r.spec);
    if (r.spec.condition) Object.freeze(r.spec.condition);
  }
  for (const d of contract.deliverables) {
    Object.freeze(d);
    Object.freeze(d.matcher);
  }
  for (const c of contract.constraints) Object.freeze(c);
  for (const p of contract.postConditions) Object.freeze(p);
  Object.freeze(contract.requirements);
  Object.freeze(contract.deliverables);
  Object.freeze(contract.constraints);
  Object.freeze(contract.postConditions);
  Object.freeze(contract.acceptance.tiers);
  Object.freeze(contract.acceptance);
  return Object.freeze(contract);
}

// ─── The compiler (deterministic core = the FLOOR) ───────────────────────────

/**
 * Compile the RunContract from task inputs. Deterministic, pure, NO LLM, NO fs —
 * this is the FLOOR that guarantees a non-empty contract without any model call.
 * The optional LLM decomposition (decompose.ts) only ADDS to this; it never
 * replaces it.
 *
 * DAG law: reads task prose + declared contract + required tools + comprehend
 * classification. Never reads loop state.
 */
export function compileRunContract(
  task: string,
  opts: CompileRunContractOptions = {},
): RunContract {
  const requirements: TaskRequirement[] = [];
  const deliverables: DeliverableSpec[] = [];
  const constraints: Constraint[] = [];
  const postConditions: PostCondition[] = [];
  const seenCond = new Set<string>();

  const pushCondition = (c: PostCondition): void => {
    const key = JSON.stringify(c);
    if (seenCond.has(key)) return;
    seenCond.add(key);
    postConditions.push(c);
  };

  // 1. Tool coverage — requiredTools + declared TaskContract required tools.
  const declaredRequired =
    opts.taskContract?.tools
      ?.filter((t) => t.kind === "required")
      .map((t) => t.name) ?? [];
  const requiredTools: string[] = [];
  for (const tool of [...(opts.requiredTools ?? []), ...declaredRequired]) {
    if (typeof tool === "string" && tool.length > 0 && !requiredTools.includes(tool)) {
      requiredTools.push(tool);
    }
  }
  for (const tool of requiredTools) {
    const condition = toolCalled(tool);
    requirements.push({
      id: `tool:${tool}`,
      kind: "tool-coverage",
      spec: { description: `call the \`${tool}\` tool`, condition, acceptance: "deterministic" },
      weight: 1,
    });
    pushCondition(condition);
  }

  // 2. Artifact-produced — ALL literal deliverable paths (audit 01-F5 multi-path).
  const paths = deriveDeliverablePaths(task);
  for (const path of paths) {
    const condition = artifactProduced(path);
    requirements.push({
      id: `artifact:${path}`,
      kind: "artifact-produced",
      spec: { description: `produce the file ${path}`, condition, acceptance: "deterministic" },
      weight: 2,
    });
    deliverables.push({ id: `artifact:${path}`, kind: "file", matcher: condition, acceptance: "deterministic" });
    pushCondition(condition);
  }
  // A derived artifact implies a writing tool must have been called.
  if (paths.length > 0) {
    const writer = pickWritingTool(requiredTools);
    const writerCond = toolCalled(writer);
    if (!seenCond.has(JSON.stringify(writerCond))) {
      requirements.push({
        id: `tool:${writer}`,
        kind: "tool-coverage",
        spec: { description: `call the \`${writer}\` tool`, condition: writerCond, acceptance: "deterministic" },
        weight: 1,
      });
      pushCondition(writerCond);
    }
  }

  // 3. Output-format sections — declared TaskContract mustInclude → deterministic
  //    OutputContains question-answered requirements.
  for (const inc of opts.taskContract?.outputShape?.mustInclude ?? []) {
    if (typeof inc !== "string" || inc.length === 0) continue;
    const condition = outputContains(inc);
    if (seenCond.has(JSON.stringify(condition))) continue;
    requirements.push({
      id: `output:${inc}`,
      kind: "question-answered",
      spec: { description: `include "${inc}" in the answer`, condition, acceptance: "deterministic" },
      weight: 1,
    });
    deliverables.push({ id: `output:${inc}`, kind: "answer-section", matcher: condition, acceptance: "deterministic" });
    pushCondition(condition);
  }

  // 4. Constraints — forbidden tools + output format (from declared TaskContract).
  for (const t of opts.taskContract?.tools ?? []) {
    if (t.kind === "forbidden") constraints.push({ kind: "forbidden-tool", tool: t.name });
  }
  const fmt = opts.taskContract?.outputShape?.format;
  if (typeof fmt === "string" && fmt.length > 0) {
    constraints.push({ kind: "output-format", format: fmt });
  }

  // 5. The question-answered FLOOR — always present. Guarantees a non-empty
  //    contract for every task (even a bare Q&A with no tools / files), and
  //    anchors "the answer must actually address the task" as a first-class
  //    requirement the checker / self-critique tier judges.
  requirements.push({
    id: "answer",
    kind: "question-answered",
    spec: {
      description: "produce a substantive answer that addresses the task",
      acceptance: "self-critique",
    },
    weight: 1,
  });

  const horizon = opts.horizon ?? classifyTaskHorizon(task).horizon;
  const hasDeterministicDeliverable = deliverables.some((d) => d.acceptance === "deterministic");
  const acceptance: AcceptancePolicy = {
    tiers: ["deterministic", "checker", "self-critique"],
    stakes: hasDeterministicDeliverable ? "high" : "standard",
  };

  return freezeContract({
    requirements,
    deliverables,
    constraints,
    horizon,
    acceptance,
    postConditions,
  });
}

// ─── LLM-decomposition merge (the floor invariant) ───────────────────────────

/**
 * Merge LLM-decomposed requirements onto the deterministic floor. The floor is
 * NEVER removed or replaced — LLM requirements are only ADDED, and only when
 * their id does not collide with a floor requirement. Pure + deterministic given
 * its inputs, so the floor invariant is unit-testable without any model call.
 */
export function mergeLlmRequirements(
  floor: readonly TaskRequirement[],
  llmDerived: readonly TaskRequirement[],
): readonly TaskRequirement[] {
  const seen = new Set(floor.map((r) => r.id));
  const added = llmDerived.filter((r) => !seen.has(r.id));
  return [...floor, ...added];
}

/**
 * Rebuild a frozen contract with an amended requirement set (used after LLM
 * decomposition and by the Phase-4b amend seam). Recomputes the postConditions
 * floor and re-freezes. Deliverables/constraints/horizon/acceptance carry over.
 */
export function withRequirements(
  contract: RunContract,
  requirements: readonly TaskRequirement[],
): RunContract {
  const postConditions: PostCondition[] = [];
  const seen = new Set<string>();
  for (const r of requirements) {
    if (!r.spec.condition) continue;
    const key = JSON.stringify(r.spec.condition);
    if (seen.has(key)) continue;
    seen.add(key);
    postConditions.push(r.spec.condition);
  }
  return freezeContract({ ...contract, requirements, postConditions });
}

// ─── Mutation seam (Phase 4b) ────────────────────────────────────────────────

/**
 * A ledger-recorded mid-run amendment to the contract. The ONLY sanctioned way
 * a frozen contract changes after compile (DAG law: control actions re-enter as
 * ledger entries). Typed now; `ledgerEntryId` is wired in Phase 4b when the
 * RunLedger exists — until then `amendContract` is a reserved seam with no
 * production caller.
 */
export interface ContractAmendment {
  readonly requirement: TaskRequirement;
  readonly reason: string;
  /** The RunLedger `contract-amended` entry id that authorized this (Phase 4b). */
  readonly ledgerEntryId: string;
}

/**
 * Apply a ledger-recorded amendment, returning a NEW frozen contract (the
 * original stays frozen/untouched). Reserved seam — not called in production
 * until the Phase-4b ledger emits `contract-amended` entries.
 */
export function amendContract(
  contract: RunContract,
  amendment: ContractAmendment,
): RunContract {
  return withRequirements(contract, [...contract.requirements, amendment.requirement]);
}
