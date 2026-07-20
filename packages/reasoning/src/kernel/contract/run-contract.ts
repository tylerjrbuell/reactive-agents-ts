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
// runtime loop state — no back-edges.

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
}

/** A concrete producible output the receipt reports as produced|missing. */
export interface DeliverableSpec {
  /** Stable id (mirrors the owning requirement's id). */
  readonly id: string;
  readonly kind: "file" | "answer-section" | "structured-object";
  /** How to verify it was produced — a live PostCondition (graft). */
  readonly matcher: PostCondition;
}

/** A hard boundary the run must not cross. */
export type Constraint =
  | { readonly kind: "forbidden-tool"; readonly tool: string }
  | { readonly kind: "output-format"; readonly format: string };

/**
 * The declared deny-list: tool names the contract forbids. This is the ONLY
 * read path for `constraints.forbidden-tool`, and it backs the hard guarantee
 * documented on `TaskContract.tools` ("the tool MUST NOT be visible to the
 * LLM"). Consumed by the tool-surface resolver, where deny beats every
 * visibility floor (required / allowed / meta).
 *
 * An absent contract yields an empty list, so the default surface is unchanged.
 */
export function forbiddenTools(contract: RunContract | undefined): readonly string[] {
  if (contract === undefined) return [];
  return contract.constraints
    .filter((c): c is { kind: "forbidden-tool"; tool: string } => c.kind === "forbidden-tool")
    .map((c) => c.tool);
}

/** The compiled, frozen answer to "what does DONE mean for this run?". */
export interface RunContract {
  readonly requirements: readonly TaskRequirement[];
  readonly deliverables: readonly DeliverableSpec[];
  readonly constraints: readonly Constraint[];
  readonly horizon: TaskHorizon;
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
    });
    deliverables.push({ id: `artifact:${path}`, kind: "file", matcher: condition });
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
    });
    deliverables.push({ id: `output:${inc}`, kind: "answer-section", matcher: condition });
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
  });

  const horizon = opts.horizon ?? classifyTaskHorizon(task).horizon;

  return freezeContract({
    requirements,
    deliverables,
    constraints,
    horizon,
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
 * decomposition). Recomputes the postConditions floor and re-freezes.
 * Deliverables/constraints/horizon carry over.
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
