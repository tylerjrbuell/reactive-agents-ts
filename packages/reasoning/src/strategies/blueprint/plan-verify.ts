// File: src/strategies/blueprint/plan-verify.ts
//
// blueprint plan-VERIFY gate (PACT: plan → VERIFY → execute).
//
// blueprint plans a whole tool-DAG up front then executes it with NO mid-course
// observation. Weak/local models are unreliable one-shot DAG planners, so the
// plan MUST be checked deterministically before execution — otherwise garbage
// executes silently. This module is the gate: a PURE, synchronous function
// (no LLM, no Effect) that validates a hydrated Plan and repairs the fixable
// gaps (missing required tools, healable tool names).
//
// Returns one of:
//   - "ok"       — passed every check clean.
//   - "repaired" — fixed required-tool / quantity gaps or healed tool names.
//   - "invalid"  — unfixable (cycle, dangling dep, unresolved #E ref, or an
//                  unknown tool with no fuzzy match). Caller degrades to reactive.
//
// Reuses the canonical Plan primitives (`extractDependencies`) rather than
// reinventing dependency analysis, and mirrors the synthetic tool_call step
// injection pattern from plan-execute.ts:299-380 for required-tool repair.

import {
  extractDependencies,
  type Plan,
  type PlanStep,
} from "../../types/plan.js";

// ─── Result Types ───

export type VerifyStatus = "ok" | "repaired" | "invalid";

export interface VerifyPlanContext {
  /** Tools the classifier deemed mandatory; each must appear as a tool_call step. */
  readonly requiredTools?: readonly string[];
  /** Per-tool minimum call counts; deficits are repaired with synthetic steps. */
  readonly requiredToolQuantities?: Record<string, number>;
  /** Names of tools actually available for execution (exact membership set). */
  readonly availableToolNames: readonly string[];
}

export interface VerifyPlanResult {
  readonly status: VerifyStatus;
  readonly plan: Plan;
  readonly reasons: readonly string[];
}

// ─── Tool-name healing (pure, mirrors tool-name-healer.ts edit-distance ≤2) ───

/** Levenshtein edit distance. */
const editDistance = (a: string, b: string): number => {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  let curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j]! + 1, // deletion
        curr[j - 1]! + 1, // insertion
        prev[j - 1]! + cost, // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n]!;
};

/**
 * Resolve a tool name against the available set.
 * Exact match wins; otherwise the closest name within ≤2 edits is returned
 * (mirrors packages/tools tool-name-healer). `null` => no confident match.
 */
const healToolName = (
  attempted: string,
  available: readonly string[],
): string | null => {
  if (available.includes(attempted)) return attempted;
  let best: string | null = null;
  let bestDist = Infinity;
  const lower = attempted.toLowerCase();
  for (const name of available) {
    const dist = editDistance(lower, name.toLowerCase());
    if (dist < bestDist) {
      bestDist = dist;
      best = name;
    }
  }
  return bestDist <= 2 ? best : null;
};

// ─── #E / from_step reference scan ───

const FROM_STEP_RE = /\{\{from_step:(s\d+)(?::summary|:full)?\}\}/g;

/** Collect every `{{from_step:sN}}` reference found in a step (args+instruction). */
const collectStepRefs = (step: PlanStep): string[] => {
  const refs: string[] = [];
  const scan = (text: string): void => {
    for (const match of text.matchAll(FROM_STEP_RE)) refs.push(match[1]!);
  };
  scan(step.instruction);
  if (step.toolArgs) {
    for (const value of Object.values(step.toolArgs)) {
      if (typeof value === "string") scan(value);
    }
  }
  return refs;
};

// ─── DAG validity (cycle + dangling-dep detection via Kahn topo-sort) ───
//
// NOTE: computeWaves() does NOT throw on cycles — it silently falls back to a
// sequential wave. So we detect cycles/dangling deps ourselves here.

interface DagCheck {
  readonly ok: boolean;
  readonly reasons: readonly string[];
}

const checkDag = (steps: readonly PlanStep[]): DagCheck => {
  const ids = new Set(steps.map((s) => s.id));
  const reasons: string[] = [];

  // 1. Dangling deps: any dependency pointing at a non-existent step.
  const adjacency = new Map<string, Set<string>>();
  for (const step of steps) {
    const deps = extractDependencies(step);
    const valid = new Set<string>();
    for (const dep of deps) {
      if (!ids.has(dep)) {
        reasons.push(
          `step ${step.id} depends on non-existent step ${dep} (dangling dependency)`,
        );
      } else {
        valid.add(dep);
      }
    }
    adjacency.set(step.id, valid);
  }
  if (reasons.length > 0) return { ok: false, reasons };

  // 2. Cycle detection (Kahn): repeatedly remove zero-indegree nodes.
  // indegree[node] = number of (valid) deps the node still waits on.
  const indegree = new Map<string, number>();
  for (const [node, deps] of adjacency) indegree.set(node, deps.size);

  // dependents[dep] = nodes that depend on dep (so we can decrement on removal).
  const dependents = new Map<string, string[]>();
  for (const [node, deps] of adjacency) {
    for (const dep of deps) {
      const list = dependents.get(dep);
      if (list) list.push(node);
      else dependents.set(dep, [node]);
    }
  }

  const queue: string[] = [];
  for (const [node, deg] of indegree) if (deg === 0) queue.push(node);
  let removed = 0;
  while (queue.length > 0) {
    const node = queue.shift()!;
    removed++;
    for (const dependent of dependents.get(node) ?? []) {
      const deg = indegree.get(dependent)! - 1;
      indegree.set(dependent, deg);
      if (deg === 0) queue.push(dependent);
    }
  }
  if (removed < ids.size) {
    const cyclic = [...indegree.entries()]
      .filter(([, deg]) => deg > 0)
      .map(([node]) => node);
    return {
      ok: false,
      reasons: [`dependency cycle detected involving steps: ${cyclic.join(", ")}`],
    };
  }

  return { ok: true, reasons: [] };
};

// ─── Synthetic step injection (mirrors plan-execute.ts:299-380) ───

const makeSyntheticToolStep = (
  steps: readonly PlanStep[],
  toolName: string,
  title: string,
  instruction: string,
  toolArgs: Record<string, unknown>,
  dependsOn: readonly string[],
): PlanStep => {
  const stepNum = steps.length + 1;
  return {
    id: `s${stepNum}`,
    seq: stepNum,
    title,
    instruction,
    type: "tool_call",
    toolName,
    toolArgs,
    dependsOn,
    status: "pending",
    retries: 0,
    tokensUsed: 0,
  };
};

// ─── Main entry ───

/**
 * Deterministically verify + repair a hydrated blueprint Plan before execution.
 *
 * Checks (in order):
 *   a. Valid DAG       — no cycles, no dangling deps.            (invalid)
 *   b. Tools exist     — every tool_call toolName is available;  (heal→repaired
 *                        unknown names healed by fuzzy match.     | else invalid)
 *   c. Resolved refs   — every {{from_step:sN}} points at an     (invalid)
 *                        EARLIER existing step (no self/forward/missing).
 *   d. Required tools  — each requiredTools entry present as a    (repaired)
 *                        tool_call (respecting quantities); gaps
 *                        repaired with synthetic steps.
 *
 * Pure + synchronous. Never mutates the input plan — returns a new plan when
 * repairs are applied; returns the input plan unchanged on "ok"/"invalid".
 */
export const verifyPlan = (
  plan: Plan,
  ctx: VerifyPlanContext,
): VerifyPlanResult => {
  const reasons: string[] = [];
  let repaired = false;

  // Work on a shallow copy of steps so the input plan is never mutated.
  let steps: PlanStep[] = plan.steps.map((s) => ({ ...s }));

  // ── (a) Valid DAG ─────────────────────────────────────────────────────────
  const dag = checkDag(steps);
  if (!dag.ok) {
    return { status: "invalid", plan, reasons: dag.reasons };
  }

  // ── (c) No unresolved #E references ─────────────────────────────────────────
  // A reference is valid only if it points at an EARLIER step that exists.
  // Self-ref, forward-ref, and missing-ref are all unfixable → invalid.
  const idToSeq = new Map(steps.map((s) => [s.id, s.seq]));
  for (const step of steps) {
    for (const ref of collectStepRefs(step)) {
      const targetSeq = idToSeq.get(ref);
      if (targetSeq === undefined) {
        reasons.push(
          `step ${step.id} references missing step ${ref} ({{from_step:${ref}}})`,
        );
      } else if (ref === step.id) {
        reasons.push(`step ${step.id} references itself ({{from_step:${ref}}})`);
      } else if (targetSeq >= step.seq) {
        reasons.push(
          `step ${step.id} (seq ${step.seq}) references later step ${ref} (seq ${targetSeq}) — forward reference`,
        );
      }
    }
  }
  if (reasons.length > 0) {
    return { status: "invalid", plan, reasons };
  }

  // ── (b) Tools exist (heal unknown names) ────────────────────────────────────
  const available = ctx.availableToolNames;
  let unknownTool = false;
  for (const step of steps) {
    if (step.type !== "tool_call" || !step.toolName) continue;
    if (available.includes(step.toolName)) continue;

    const healed = healToolName(step.toolName, available);
    if (healed === null) {
      unknownTool = true;
      reasons.push(
        `step ${step.id} calls unknown tool "${step.toolName}" with no close match in available tools`,
      );
    } else {
      reasons.push(
        `healed unknown tool name "${step.toolName}" → "${healed}" on step ${step.id}`,
      );
      step.toolName = healed;
      repaired = true;
    }
  }
  if (unknownTool) {
    return { status: "invalid", plan, reasons };
  }

  // ── (d) Required tools present (repair via synthetic injection) ──────────────
  const requiredTools = ctx.requiredTools ?? [];
  if (requiredTools.length > 0) {
    const plannedTools = new Set(
      steps
        .filter((s) => s.type === "tool_call" && s.toolName)
        .map((s) => s.toolName!),
    );
    const missingTools = requiredTools.filter((t) => !plannedTools.has(t));
    for (const tool of missingTools) {
      const lastStep = steps[steps.length - 1];
      steps.push(
        makeSyntheticToolStep(
          steps,
          tool,
          `Execute ${tool}`,
          `Call ${tool} to complete the task. Use the results from previous steps as needed.`,
          {},
          lastStep ? [lastStep.id] : [],
        ),
      );
      reasons.push(`injected synthetic tool_call step for required tool "${tool}"`);
      repaired = true;
    }
  }

  // ── (d') Quantity enforcement (repair deficits) ─────────────────────────────
  const quantities = ctx.requiredToolQuantities ?? {};
  for (const [toolName, requiredCount] of Object.entries(quantities)) {
    const existingCount = steps.filter(
      (s) => s.type === "tool_call" && s.toolName === toolName,
    ).length;
    const deficit = requiredCount - existingCount;
    for (let i = 0; i < deficit; i++) {
      steps.push(
        makeSyntheticToolStep(
          steps,
          toolName,
          `${toolName} (additional #${existingCount + i + 1})`,
          `Call ${toolName} to fetch additional data needed for the goal. At least ${requiredCount} calls are required to cover all entities.`,
          {},
          [],
        ),
      );
      reasons.push(
        `injected synthetic tool_call step for required tool "${toolName}" (quantity deficit)`,
      );
      repaired = true;
    }
  }

  if (!repaired) {
    return { status: "ok", plan, reasons };
  }

  const now = new Date().toISOString();
  const repairedPlan: Plan = {
    ...plan,
    steps,
    version: plan.version + 1,
    updatedAt: now,
  };
  return { status: "repaired", plan: repairedPlan, reasons };
};
