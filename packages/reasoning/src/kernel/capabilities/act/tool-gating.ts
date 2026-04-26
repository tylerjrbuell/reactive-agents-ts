/**
 * kernel/utils/tool-gating.ts — Parallel-batch safety, required-tool gating,
 * per-tool quota enforcement, tool-elaboration injection, and next-move
 * batching plans.
 *
 * Extracted from tool-utils.ts. All functions are pure (no Effect dependencies).
 */

import { META_TOOLS as META_TOOLS_SET } from "../../../kernel/state/kernel-constants.js";

// ── Config / Conflict types ───────────────────────────────────────────────────

export type ToolElaborationInjectionConfig = {
  readonly enabled?: boolean;
  readonly maxHintsPerTool?: number;
};

export type NextMovesPlanningConfig = {
  readonly enabled?: boolean;
  readonly maxBatchSize?: number;
  readonly allowParallelBatching?: boolean;
};

export type QuotaBudgetConflict = {
  readonly toolName: string;
  readonly requiredMinCalls: number;
  readonly maxCalls: number;
  readonly actualCalls: number;
};

// ── Tool Elaboration ──────────────────────────────────────────────────────────

function describeToolBehavior(name: string): readonly string[] {
  const lowered = name.toLowerCase();
  if (lowered.includes("search") || lowered.includes("http") || lowered.includes("fetch") || lowered.includes("get")) {
    return [
      "Use for read-only lookup and data retrieval.",
      "Independent calls can be grouped before the next think step.",
      "Prefer concrete, narrow arguments to reduce noisy observations.",
    ];
  }
  if (lowered.includes("read") || lowered.includes("list") || lowered.includes("query")) {
    return [
      "Use for read-only inspection.",
      "Safe candidate for short-term batched execution.",
      "Return focused slices over broad payloads when possible.",
    ];
  }
  if (lowered.includes("write") || lowered.includes("delete") || lowered.includes("update") || lowered.includes("create")) {
    return [
      "Has side effects; execute with explicit intent.",
      "Avoid batching with other mutating calls unless ordering is guaranteed.",
      "Confirm target path/resource arguments before invocation.",
    ];
  }
  return [
    "Use only when arguments are complete and specific.",
    "Prefer one clear objective per call.",
    "If multiple independent calls are needed, batch only safe read-like calls.",
  ];
}

export function isParallelBatchSafeTool(name: string): boolean {
  // Explicitly safe tools — dispatching multiple in parallel is always correct.
  const PARALLEL_SAFE_TOOLS = new Set([
    "spawn-agent",   // single subagent dispatch
    "spawn-agents",  // parallel subagent dispatch
    "recall",        // scratchpad read — pure, no side effect
    "find",          // index lookup — pure, no side effect
  ]);
  if (PARALLEL_SAFE_TOOLS.has(name)) return true;

  const lowered = name.toLowerCase();
  if (META_TOOLS_SET.has(name)) return false;
  if (lowered.includes("final-answer")) return false;
  if (lowered.includes("write") || lowered.includes("delete") || lowered.includes("update") || lowered.includes("create")) {
    return false;
  }
  return (
    lowered.includes("search") ||
    lowered.includes("http") ||
    lowered.includes("fetch") ||
    lowered.includes("get") ||
    lowered.includes("read") ||
    lowered.includes("list") ||
    lowered.includes("query")
  );
}

export function buildToolElaborationInjection(
  toolSchemas: readonly { readonly name: string; readonly parameters?: readonly { readonly name: string }[] }[],
  config?: ToolElaborationInjectionConfig,
): string {
  if (!config?.enabled || toolSchemas.length === 0) return "";
  const maxHints = Math.max(1, config.maxHintsPerTool ?? 2);
  const lines = toolSchemas.map((tool) => {
    const hints = describeToolBehavior(tool.name).slice(0, maxHints);
    const args = (tool.parameters ?? []).map((p) => p.name).join(", ");
    const argsLine = args.length > 0 ? `required args: ${args}` : "required args: none";
    return [
      `- ${tool.name}`,
      `  - ${argsLine}`,
      ...hints.map((h) => `  - ${h}`),
    ].join("\n");
  });
  return [
    "## Tool Elaboration (lightweight)",
    "Use these tool-specific hints to choose precise calls and avoid dead iterations.",
    ...lines,
  ].join("\n");
}

export function planNextMoveBatches<T extends { readonly name: string }>(
  calls: readonly T[],
  config?: NextMovesPlanningConfig,
): readonly (readonly T[])[] {
  if (calls.length === 0) return [];
  if (!config?.enabled) return calls.map((c) => [c]);

  const allowParallel = config.allowParallelBatching ?? true;
  if (!allowParallel) return calls.map((c) => [c]);

  const maxBatchSize = Math.max(1, config.maxBatchSize ?? 3);
  const batches: T[][] = [];
  let current: T[] = [];

  for (const call of calls) {
    const safe = isParallelBatchSafeTool(call.name);
    if (!safe) {
      if (current.length > 0) {
        batches.push(current);
        current = [];
      }
      batches.push([call]);
      continue;
    }

    current.push(call);
    if (current.length >= maxBatchSize) {
      batches.push(current);
      current = [];
    }
  }

  if (current.length > 0) {
    batches.push(current);
  }

  return batches;
}

/**
 * Gate native parallel tool batches against {@link requiredTools} so optional tools
 * (e.g. http-get) cannot run while a required tool (e.g. file-write) is still missing.
 *
 * - Pre-filters calls that have exceeded their per-tool budget (`maxCallsPerTool`).
 * - If required minCalls conflict with maxCallsPerTool (or budget already exhausted), return
 *   an explicit quotaBudgetConflict and block optional calls.
 * - If calls target missing required tools, return the first safe required batch
 *   (can contain multiple parallel-safe calls).
 * - If calls are all from {@link relevantTools} or satisfied required → allow through.
 * - If calls omit every missing required tool and aren't relevant:
 *   - strict mode: block batch (`blockedOptionalBatch: true`)
 *   - default mode: allow one exploratory call to preserve discovery context.
 */
export function gateNativeToolCallsForRequiredTools<T extends { readonly name: string }>(
  calls: readonly T[],
  requiredTools: readonly string[],
  toolsUsed: ReadonlySet<string>,
  relevantTools?: readonly string[],
  toolCallCounts?: Readonly<Record<string, number>>,
  maxCallsPerTool?: Readonly<Record<string, number>>,
  requiredToolQuantities?: Readonly<Record<string, number>>,
  strictDependencyChain?: boolean,
  nextMovesPlanning?: NextMovesPlanningConfig,
): {
  readonly effective: readonly T[];
  readonly blockedOptionalBatch: boolean;
  readonly quotaBudgetConflict?: readonly QuotaBudgetConflict[];
} {
  const enforceSingleStep = nextMovesPlanning?.enabled === false;
  const applyStepMode = (selected: readonly T[]): readonly T[] =>
    enforceSingleStep && selected.length > 1 ? [selected[0]!] : selected;

  // Layer 3: pre-filter calls that have exhausted their per-tool budget.
  const budgeted =
    maxCallsPerTool && toolCallCounts
      ? calls.filter((c) => {
          const max = maxCallsPerTool[c.name];
          return max === undefined || (toolCallCounts[c.name] ?? 0) < max;
        })
      : calls;

  if (requiredTools.length === 0) {
    return { effective: applyStepMode(budgeted), blockedOptionalBatch: false };
  }
  const quantities = requiredToolQuantities ?? {};
  const getActualCalls = (toolName: string): number =>
    toolCallCounts?.[toolName] ?? (toolsUsed.has(toolName) ? 1 : 0);
  const isRequiredSatisfied = (toolName: string): boolean =>
    getActualCalls(toolName) >= (quantities[toolName] ?? 1);

  const missing = requiredTools.filter((t) => !isRequiredSatisfied(t));
  if (missing.length === 0) {
    return { effective: applyStepMode(budgeted), blockedOptionalBatch: false };
  }
  const quotaBudgetConflict = missing
    .map((toolName): QuotaBudgetConflict | null => {
      const maxCalls = maxCallsPerTool?.[toolName];
      if (maxCalls === undefined) return null;
      const requiredMinCalls = quantities[toolName] ?? 1;
      const actualCalls = getActualCalls(toolName);
      const impossibleByConfiguration = requiredMinCalls > maxCalls;
      const exhaustedBudget = actualCalls >= maxCalls && actualCalls < requiredMinCalls;
      if (!impossibleByConfiguration && !exhaustedBudget) return null;
      return {
        toolName,
        requiredMinCalls,
        maxCalls,
        actualCalls,
      };
    })
    .filter((entry): entry is QuotaBudgetConflict => entry !== null);
  if (quotaBudgetConflict.length > 0) {
    return {
      effective: [],
      blockedOptionalBatch: true,
      quotaBudgetConflict,
    };
  }

  const towardMissing = budgeted.filter((c) => missing.includes(c.name));
  if (towardMissing.length > 0) {
    const maxBatchSize = Math.max(1, nextMovesPlanning?.maxBatchSize ?? 4);
    const requiredBatches = planNextMoveBatches(towardMissing, {
      enabled: true,
      maxBatchSize,
      allowParallelBatching: true,
    });
    return { effective: applyStepMode(requiredBatches[0] ?? []), blockedOptionalBatch: false };
  }
  // Allow relevant tools and re-calls of already-satisfied required tools.
  const satisfiedRequired = new Set(
    requiredTools.filter((t) => isRequiredSatisfied(t)),
  );
  const allowedSet = new Set([...(relevantTools ?? []), ...satisfiedRequired]);
  if (allowedSet.size > 0) {
    const allowedCalls = budgeted.filter((c) => allowedSet.has(c.name));
    if (allowedCalls.length > 0) {
      return { effective: applyStepMode(allowedCalls), blockedOptionalBatch: false };
    }
  }
  // Strict mode enforces required-tool hierarchy before exploratory context gathering.
  if (strictDependencyChain) {
    return { effective: [], blockedOptionalBatch: budgeted.length > 0 || calls.length > 0 };
  }

  // Non-strict mode keeps progress moving by allowing one exploratory call.
  if (budgeted.length > 0) {
    return { effective: applyStepMode([budgeted[0]!]), blockedOptionalBatch: false };
  }
  return { effective: [], blockedOptionalBatch: false };
}
