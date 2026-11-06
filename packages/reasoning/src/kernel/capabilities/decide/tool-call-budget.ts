/**
 * Tool-call budget for direct dispatch — `maxCallsPerTool` outside a kernel.
 *
 * Inside a kernel pass the think-phase tool gate (`tool-gating.ts`) enforces
 * `maxCallsPerTool`. Some strategies also run tools with no kernel and no
 * model turn: plan-execute and blueprint `tool_call` plan steps
 * (`executeToolAndObserve` with a ledger sink) and code-action's sandbox
 * tool bridge. Those paths reserve each call here. The strategy substrate
 * builds one budget per strategy run from `RunEnvelope.rails.maxCallsPerTool`
 * (`StrategyRun.toolCallBudget`) over the run's one call count
 * (`run-tool-call-counts.ts`), the same count the kernel gate reads and
 * charges, so a cap holds across every pass and dispatch path of the run.
 *
 * A refusal uses the same text and the same `guard-fired{guard:"tool-gate"}`
 * event as a kernel-gate refusal, so a reader sees one rule, not two.
 */
import { Effect } from "effect";
import { emitGuardFired } from "../../utils/diagnostics.js";
import { budgetExhaustedReason } from "./tool-gating.js";
import { TOOL_GATE_ACTOR } from "./tool-call-refusals.js";
import { chargeToolCall, type ToolCallCounts } from "./run-tool-call-counts.js";

/** One run's direct-dispatch call budget: the run's caps over the run's counts. */
export interface ToolCallBudget {
  /**
   * Reserve one call to `toolName`. Returns `undefined` when the call may run
   * (and counts it), or the refusal text when its cap is used up (not counted).
   * Synchronous check-and-count, so concurrent plan steps cannot overrun a cap.
   */
  readonly reserve: (toolName: string) => string | undefined;
}

/** A budget that never refuses (no caps configured). */
export const unlimitedToolCallBudget: ToolCallBudget = { reserve: () => undefined };

/**
 * Build a run's budget from its caps over `counts` (the run's call count;
 * a fresh count when omitted). No caps ⇒ {@link unlimitedToolCallBudget}.
 */
export function makeToolCallBudget(
  maxCallsPerTool: Readonly<Record<string, number>> | undefined,
  counts: ToolCallCounts = new Map(),
): ToolCallBudget {
  if (maxCallsPerTool === undefined) return unlimitedToolCallBudget;
  return {
    reserve: (toolName) => {
      const max = maxCallsPerTool[toolName];
      if (max === undefined) return undefined;
      const used = counts.get(toolName) ?? 0;
      if (used >= max) return `${toolName} was not run: ${budgetExhaustedReason(toolName, used, max)}`;
      chargeToolCall(counts, toolName);
      return undefined;
    },
  };
}

/** The `guard-fired` event for a direct-dispatch budget refusal (same shape as the kernel gate's). */
export function emitBudgetRefusal(args: {
  readonly taskId: string;
  readonly iteration: number;
  readonly toolName: string;
  readonly reason: string;
  readonly toolCallId?: string;
}): Effect.Effect<void, never> {
  return emitGuardFired({
    taskId: args.taskId,
    iteration: args.iteration,
    guard: TOOL_GATE_ACTOR,
    outcome: "block",
    reason: args.reason,
    metadata: {
      toolName: args.toolName,
      ...(args.toolCallId !== undefined ? { toolCallId: args.toolCallId } : {}),
      kind: "budget-exhausted",
    },
  });
}
