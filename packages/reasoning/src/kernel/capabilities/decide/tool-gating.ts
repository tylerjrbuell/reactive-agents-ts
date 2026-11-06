/**
 * Tool gating — Decide capability concern (pre-Act selection).
 *
 * Tool gating answers "which subset of permitted tools is the agent
 * allowed to fire on this iter?" That is a Decide concern (pre-Act
 * filtering), per Mission Pillar 5: the Arbitrator integrates signals
 * into one Verdict; tool gating narrows the candidate set the Verdict
 * applies to.
 *
 * Moved from kernel/capabilities/act/tool-gating.ts in WS-3 Phase 2
 * (ADR: wiki/Decisions/2026-05-28-tool-gating-disposition.md option (a)).
 */

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

// ── Durable HITL approval gate (Phase D) ──────────────────────────────────────

/**
 * Resolved approval-gate config threaded onto `KernelInput.approvalPolicy`. The
 * runtime merges all three feeders into this single shape at config-assembly
 * time: per-tool `requiresApproval` flags and the builder `tools` list are
 * unioned into `tools`; the builder/compose predicate becomes `requireFor`. The
 * kernel therefore stays pure — no tool-definition lookup needed here.
 */
export interface ApprovalGateConfig {
  readonly tools: ReadonlySet<string>;
  readonly requireFor?: (ctx: { toolName: string; iteration: number }) => boolean;
}

/**
 * True when a pending tool call must pause for human approval. ORs the two
 * resolved feeders: the merged tool-name set and the predicate. Pure — no
 * Effect, no IO. (The per-tool `requiresApproval` flag is folded into
 * `policy.tools` by the runtime before this is called.)
 */
export function shouldGate(
  toolName: string,
  policy: ApprovalGateConfig,
  ctx: { iteration: number },
): boolean {
  if (policy.tools.has(toolName)) return true;
  if (policy.requireFor?.({ toolName, iteration: ctx.iteration })) return true;
  return false;
}

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

/** Which gate rule kept a model-emitted call from running this turn. */
export type GateRefusalKind =
  | "budget-exhausted"
  | "single-step"
  | "required-first"
  | "not-relevant"
  | "exploratory-limit"
  | "strict-dependency"
  | "quota-conflict";

/**
 * A call the gate did not pass to Act, with the rule and a model-facing reason
 * (the text after "<tool> was not run: "). Every emitted call is either in
 * `effective` or here — the gate never drops one silently.
 */
export type GateRefusal<T> = {
  readonly call: T;
  readonly kind: GateRefusalKind;
  readonly reason: string;
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
    "spawn-agent",    // single subagent dispatch
    "spawn-agents",   // parallel subagent dispatch
    "recall",         // scratchpad read — pure, no side effect
    "find",           // index lookup — pure, no side effect
    // shell-execute is the agent's primary I/O surface. Treating it as
    // sequential-only caps the per-task budget at 2 calls (via
    // `repetitionGuard`), which is too tight for any non-trivial audit
    // or multi-step shell workflow. Destructive ops are still blocked by
    // the shell-execute tool's own allow/block lists; the kernel does not
    // need to be a second gate.
    "shell-execute",
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

/**
 * Conversational reply tools — the channel's outbound messaging surface
 * (Signal/Telegram/Slack/Discord send/reply/DM tools, typically MCP-namespaced
 * as `server/send_message_to_user`).
 *
 * These are *repeatable output channels*, not once-only mutations. The gateway
 * guidance (gateway-context-formatting.ts:channelOutboundToolGuidance) explicitly
 * instructs the model to call them more than once — "call it first with a brief
 * acknowledgement, then again with your final answer." Treating them as once-only
 * side effects (the `sideEffectGuard` default) blocks the second call and silently
 * drops the real answer.
 *
 * Matching is anchored to chat-messaging name patterns, NOT the bare verb "send",
 * so once-only mutations like `send-email`, `create-issue`, `file-write` are
 * deliberately excluded — sending those twice is a genuine bug.
 */
const CONVERSATIONAL_REPLY_PATTERNS = [
  "send_message",
  "sendmessage",
  "send_msg",
  "message_to",
  "post_message",
  "send_dm",
  "direct_message",
  "reply", // reply_to_last_sender, reply_to_message, reply
] as const;

export function isConversationalReplyTool(name: string): boolean {
  const lowered = name.toLowerCase();
  return CONVERSATIONAL_REPLY_PATTERNS.some((p) => lowered.includes(p));
}

/**
 * Whether the tool-calling driver's prompt instructions should be injected into
 * the system prompt for this turn.
 *
 * In `text-parse` mode the driver's instructions (the `<tool_call>` text format)
 * ARE the model's only mechanism to emit a call — they must ALWAYS be injected,
 * even on compact local profiles ("names-only" / "names-and-types"). Suppressing
 * them strands the model: it sees tool names and "you must call a tool" but has
 * no format to express one, so it emits prose and stalls.
 *
 * In `native-fc` mode the driver carries tools natively and its instruction
 * string is empty, so the compact-profile suppression (which exists to avoid
 * leaking full tool descriptions the profile chose to hide) is harmless and
 * preserved.
 */
export function shouldInjectDriverInstructions(
  mode: "native-fc" | "text-parse",
  toolSchemaDetail: string | undefined,
): boolean {
  if (mode === "text-parse") return true;
  return toolSchemaDetail !== "names-only" && toolSchemaDetail !== "names-and-types";
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

/** Why a call over its `maxCallsPerTool` cap is refused (kernel gate and direct dispatch share it). */
export const budgetExhaustedReason = (toolName: string, used: number, max: number): string =>
  `its per-tool call budget is used up (${used} of ${max} calls). Do not call ${toolName} again; work with the results you already have.`;

/**
 * Gate native parallel tool batches against {@link requiredTools} so optional tools
 * (e.g. http-get) cannot run while a required tool (e.g. file-write) is still missing.
 *
 * - Pre-filters calls that have exceeded their per-tool budget (`maxCallsPerTool`).
 * - If required minCalls conflict with maxCallsPerTool (or budget already exhausted), return
 *   an explicit quotaBudgetConflict and block optional calls.
 * - If calls target missing required tools, return every one of them, in order
 *   (Act runs non-parallel-safe calls one at a time); other calls are refused.
 * - If calls are all from {@link relevantTools} or satisfied required → allow through.
 * - If calls omit every missing required tool and aren't relevant:
 *   - strict mode: block batch (`blockedOptionalBatch: true`)
 *   - default mode: allow one exploratory call to preserve discovery context.
 *
 * `refused` lists every input call NOT in `effective`, in input order, with the
 * rule that kept it out (`effective` + `refused` always cover `calls`).
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
  /**
   * Calls the run already spent per capped tool (the run's one count,
   * `run-tool-call-counts.ts`). The budget reads this, not the success counts
   * the required-tool quotas read. Absent: `toolCallCounts` (a bare pass).
   */
  budgetUsed?: Readonly<Record<string, number>>,
): {
  readonly effective: readonly T[];
  readonly blockedOptionalBatch: boolean;
  readonly quotaBudgetConflict?: readonly QuotaBudgetConflict[];
  readonly refused: readonly GateRefusal<T>[];
} {
  const enforceSingleStep = nextMovesPlanning?.enabled === false;
  const applyStepMode = (selected: readonly T[]): readonly T[] =>
    enforceSingleStep && selected.length > 1 ? [selected[0]!] : selected;

  // Layer 3: pre-filter calls that have exhausted their per-tool budget.
  // `used` = the run's prior calls + calls already admitted earlier in THIS
  // turn, so a parallel batch cannot overrun the cap.
  const budgetRefused = new Map<T, GateRefusal<T>>();
  const admitted: Record<string, number> = {};
  const budgeted =
    maxCallsPerTool
      ? calls.filter((c) => {
          const max = maxCallsPerTool[c.name];
          const used = ((budgetUsed ?? toolCallCounts)?.[c.name] ?? 0) + (admitted[c.name] ?? 0);
          if (max === undefined) return true;
          if (used < max) {
            admitted[c.name] = (admitted[c.name] ?? 0) + 1;
            return true;
          }
          budgetRefused.set(c, { call: c, kind: "budget-exhausted", reason: budgetExhaustedReason(c.name, used, max) });
          return false;
        })
      : calls;

  // Every return goes through `settle`: `selected` is what the branch keeps,
  // `why` explains a budgeted call the branch left out (absent: the branch
  // keeps every budgeted call, so only the budget and single-step refuse).
  const settle = (
    selected: readonly T[],
    why: (c: T) => Pick<GateRefusal<T>, "kind" | "reason"> = () => ({ kind: "single-step", reason: "not run this turn." }),
    extra: { readonly blockedOptionalBatch?: boolean; readonly quotaBudgetConflict?: readonly QuotaBudgetConflict[] } = {},
  ) => {
    const effective = applyStepMode(selected);
    const kept = new Set(effective);
    const chosen = new Set(selected);
    const refused = calls.flatMap((c): GateRefusal<T>[] => {
      const overBudget = budgetRefused.get(c);
      if (overBudget) return [overBudget];
      if (kept.has(c)) return [];
      if (chosen.has(c)) {
        return [{ call: c, kind: "single-step", reason: "this run executes one tool call per turn. Call it again next turn if you still need it." }];
      }
      return [{ call: c, ...why(c) }];
    });
    return { effective, blockedOptionalBatch: extra.blockedOptionalBatch ?? false, ...(extra.quotaBudgetConflict ? { quotaBudgetConflict: extra.quotaBudgetConflict } : {}), refused };
  };
  if (requiredTools.length === 0) {
    return settle(budgeted);
  }
  const quantities = requiredToolQuantities ?? {};
  const getActualCalls = (toolName: string): number =>
    toolCallCounts?.[toolName] ?? (toolsUsed.has(toolName) ? 1 : 0);
  const isRequiredSatisfied = (toolName: string): boolean =>
    getActualCalls(toolName) >= (quantities[toolName] ?? 1);

  const missing = requiredTools.filter((t) => !isRequiredSatisfied(t));
  if (missing.length === 0) {
    return settle(budgeted);
  }
  const missingList = missing.join(", ");
  const quotaBudgetConflict = missing
    .map((toolName): QuotaBudgetConflict | null => {
      const maxCalls = maxCallsPerTool?.[toolName];
      if (maxCalls === undefined) return null;
      const requiredMinCalls = quantities[toolName] ?? 1;
      const actualCalls = getActualCalls(toolName);
      const impossibleByConfiguration = requiredMinCalls > maxCalls;
      // Spent budget (run count) with the quota still unmet: no call can meet it.
      const spent = budgetUsed !== undefined ? (budgetUsed[toolName] ?? 0) : actualCalls;
      const exhaustedBudget = spent >= maxCalls && actualCalls < requiredMinCalls;
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
    const conflicted = quotaBudgetConflict.map((q) => q.toolName).join(", ");
    return settle([], () => ({
      kind: "quota-conflict",
      reason: `the required-call quota for ${conflicted} cannot be met within maxCallsPerTool, so no tool runs.`,
    }), { blockedOptionalBatch: true, quotaBudgetConflict });
  }

  // Every call toward a missing required tool runs this turn, in emitted order;
  // Act batches them (planNextMoveBatches) and runs non-parallel-safe calls one
  // at a time. Deferring correct required calls to later turns was churn (H3 at
  // 6a6a7f4d5: 5 of 6 correct file-writes refused in one turn).
  const towardMissing = budgeted.filter((c) => missing.includes(c.name));
  if (towardMissing.length > 0) {
    return settle(towardMissing, () => ({
      kind: "required-first",
      reason: `required tool(s) ${missingList} are still missing, so only calls to them run this turn. Call it again after they succeed if you still need it.`,
    }));
  }
  // Allow relevant tools and re-calls of already-satisfied required tools.
  const satisfiedRequired = new Set(
    requiredTools.filter((t) => isRequiredSatisfied(t)),
  );
  const allowedSet = new Set([...(relevantTools ?? []), ...satisfiedRequired]);
  if (allowedSet.size > 0) {
    const allowedCalls = budgeted.filter((c) => allowedSet.has(c.name));
    if (allowedCalls.length > 0) {
      return settle(allowedCalls, () => ({
        kind: "not-relevant",
        reason: `required tool(s) ${missingList} are still missing; until they are called only relevant tools run.`,
      }));
    }
  }
  // Strict mode enforces required-tool hierarchy before exploratory context gathering.
  if (strictDependencyChain) {
    return settle([], () => ({
      kind: "strict-dependency",
      reason: `strict dependency mode runs no other tool until required tool(s) ${missingList} are called.`,
    }), { blockedOptionalBatch: budgeted.length > 0 || calls.length > 0 });
  }

  // Non-strict mode keeps progress moving by allowing one exploratory call.
  return settle(budgeted.length > 0 ? [budgeted[0]!] : [], () => ({
    kind: "exploratory-limit",
    reason: `required tool(s) ${missingList} are still missing; only one other call runs per turn until they are called.`,
  }));
}
