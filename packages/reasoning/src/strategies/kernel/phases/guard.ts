/**
 * Guard pipeline for the acting phase.
 *
 * Each Guard is a pure function: (toolCall, state, input) → GuardOutcome.
 * Guards run in order; first failure short-circuits with an observation
 * injected back into the LLM context on the next turn.
 *
 * Strategies configure their own chain by passing a custom Guard[] to checkToolCall().
 */
import type { KernelState, ReActKernelInput } from "../kernel-state.js";
import type { ToolCallSpec } from "@reactive-agents/tools";
import { isParallelBatchSafeTool } from "../utils/tool-utils.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type GuardOutcome =
  | { readonly pass: true }
  | { readonly pass: false; readonly observation: string };

export type Guard = (
  tc: ToolCallSpec,
  state: KernelState,
  input: ReActKernelInput,
) => GuardOutcome;

// ─── Shared Constants ─────────────────────────────────────────────────────────

const META_TOOL_NAMES = new Set([
  "final-answer", "task-complete", "context-status",
  "brief", "pulse", "find", "recall", "checkpoint",
]);

const isDelegationTool = (toolName: string): boolean =>
  toolName === "spawn-agent" || toolName.startsWith("agent-");

/** Meta-introspection tools subject to dedup spam detection. */
export const META_TOOL_SET = new Set(["brief", "pulse", "find", "recall", "checkpoint"]);

// ─── Individual Guards ────────────────────────────────────────────────────────

/** Blocks tools explicitly listed in input.blockedTools. */
export const blockedGuard: Guard = (tc, _state, input) => {
  const isBlocked = input.blockedTools?.includes(tc.name) ?? false;
  if (isBlocked) {
    return {
      pass: false,
      observation: `⚠️ BLOCKED: ${tc.name} already executed successfully in a prior pass.`,
    };
  }
  return { pass: true };
};

/** Blocks the exact same tool+arguments pair if it already succeeded. */
export const duplicateGuard: Guard = (tc, state, input) => {
  const currentActionJson = JSON.stringify({ tool: tc.name, args: tc.arguments });
  const isDuplicate = state.steps.some((step, idx) => {
    if (step.type !== "action") return false;
    const stepTc = step.metadata?.toolCall as { name: string; arguments: unknown } | undefined;
    if (!stepTc) return false;
    if (JSON.stringify({ tool: stepTc.name, args: stepTc.arguments }) !== currentActionJson) return false;
    const next = state.steps[idx + 1];
    return next?.type === "observation" && next.metadata?.observationResult?.success === true;
  });

  if (!isDuplicate) return { pass: true };

  // Surface prior result with advisory — don't re-execute
  const priorSuccessIdx = state.steps.findIndex((step, idx) => {
    if (step.type !== "action") return false;
    const stepTc = step.metadata?.toolCall as { name: string; arguments: unknown } | undefined;
    if (!stepTc) return false;
    if (JSON.stringify({ tool: stepTc.name, args: stepTc.arguments }) !== currentActionJson) return false;
    const next = state.steps[idx + 1];
    return next?.type === "observation" && next.metadata?.observationResult?.success === true;
  });
  const priorObsContent = priorSuccessIdx >= 0 ? state.steps[priorSuccessIdx + 1]?.content ?? "" : "";
  const reqTools = input.requiredTools ?? [];
  const missingReq = reqTools.filter((t) => !state.toolsUsed.has(t));
  const nextHint = missingReq.length > 0
    ? `You still need to call: ${missingReq.join(", ")}. Do that now.`
    : "Give FINAL ANSWER if all steps are complete.";
  const dupContent = `${priorObsContent} [Already done — do NOT repeat. ${nextHint}]`;

  return {
    pass: false,
    observation: dupContent,
  };
};

/** Blocks side-effect tools (send*, create*, delete*, etc.) from running twice. */
export const sideEffectGuard: Guard = (tc, state, _input) => {
  const SIDE_EFFECT_PREFIXES = ["send", "create", "delete", "push", "merge", "fork", "update", "assign", "remove"];
  const isSideEffectTool = SIDE_EFFECT_PREFIXES.some(
    (p) => tc.name.toLowerCase().includes(p),
  );
  if (!isSideEffectTool) return { pass: true };

  const sideEffectAlreadyDone = state.steps.some((step, idx) => {
    if (step.type !== "action") return false;
    const stepTc = step.metadata?.toolCall as { name: string } | undefined;
    if (stepTc?.name !== tc.name) return false;
    const next = state.steps[idx + 1];
    return next?.type === "observation" && next.metadata?.observationResult?.success === true;
  });

  if (!sideEffectAlreadyDone) return { pass: true };

  return {
    pass: false,
    observation: `⚠️ ${tc.name} already executed successfully with different parameters. Side-effect tools must NOT be called twice. Move on to the next step or give FINAL ANSWER.`,
  };
};

/** Nudges the LLM when it calls the same non-meta tool too many times.
 *  Parallel-safe tools (http-get, web-search, etc.) allow up to maxBatchSize
 *  calls before triggering; sequential-only tools are limited to 2. */
export const repetitionGuard: Guard = (tc, state, input) => {
  if (META_TOOL_NAMES.has(tc.name)) return { pass: true };
  if (isDelegationTool(tc.name)) return { pass: true };

  const priorCallsOfSameTool = state.steps.filter((s) => {
    if (s.type !== "action") return false;
    const stepTc = s.metadata?.toolCall as { name: string } | undefined;
    return (stepTc?.name ?? "") === tc.name;
  }).length;

  // Threshold priority: (1) requiredToolQuantities[tool] — ground truth from classifier,
  // (2) maxBatchSize for parallel-safe tools, (3) 2 for sequential-only tools.
  const quantityLimit = input.requiredToolQuantities?.[tc.name];
  const maxBatchSize = input.nextMovesPlanning?.maxBatchSize ?? 4;
  const threshold = quantityLimit ?? (isParallelBatchSafeTool(tc.name) ? maxBatchSize : 2);
  if (priorCallsOfSameTool < threshold) return { pass: true };

  // Build missing-tools hint with N/M count progress when quantities are known
  const reqTools = input.requiredTools ?? [];
  const quantities = input.requiredToolQuantities ?? {};
  const missingRequired = reqTools.filter((t) => {
    const needed = quantities[t] ?? 1;
    const actual = state.steps.filter((s) => {
      if (s.type !== "action") return false;
      return (s.metadata?.toolCall as { name?: string } | undefined)?.name === t;
    }).length;
    return actual < needed;
  });
  const missingHint = missingRequired.length > 0
    ? ` You still need to call: ${missingRequired.map((t) => {
        const needed = quantities[t];
        if (!needed || needed <= 1) return t;
        const actual = state.steps.filter((s) => {
          if (s.type !== "action") return false;
          return (s.metadata?.toolCall as { name?: string } | undefined)?.name === t;
        }).length;
        return `${t} (${actual}/${needed} calls done)`;
      }).join(", ")}. Do that now instead of repeating ${tc.name}.`
    : " Use final-answer to respond now.";
  const nudge = `⚠️ You have already called ${tc.name} ${priorCallsOfSameTool} times. Stop repeating this tool.${missingHint}`;

  return {
    pass: false,
    observation: nudge,
  };
};

/**
 * Returns true when the same meta-introspection tool has been called
 * consecutiveCount times already and is being called again.
 *
 * Threshold: block on the 3rd+ consecutive identical call (consecutiveCount >= 2).
 * The first repeat (count === 1) is allowed with a warning via the guard message.
 */
export function isConsecutiveMetaToolSpam(opts: {
  toolName: string;
  lastMetaToolCall: string | undefined;
  consecutiveCount: number;
}): boolean {
  if (!META_TOOL_SET.has(opts.toolName)) return false;
  return opts.toolName === opts.lastMetaToolCall && opts.consecutiveCount >= 2;
}

/**
 * Blocks a meta-introspection tool (brief/pulse/find/recall) when it has been
 * called 3+ consecutive times with the same tool name.
 * Redirects the model to either use a task tool or call final-answer.
 */
export const metaToolDedupGuard: Guard = (tc, state) => {
  if (!META_TOOL_SET.has(tc.name)) return { pass: true };
  const lastMeta = state.lastMetaToolCall;
  const count = state.consecutiveMetaToolCount ?? 0;
  if (isConsecutiveMetaToolSpam({ toolName: tc.name, lastMetaToolCall: lastMeta, consecutiveCount: count })) {
    return {
      pass: false,
      observation: `You just called ${tc.name} ${count} times in a row. Nothing has changed. Stop calling ${tc.name} and either use a task tool or call final-answer.`,
    };
  }
  return { pass: true };
};

// ─── Default Pipeline ─────────────────────────────────────────────────────────

/** Default guard chain used by the standard ReAct kernel. */
export const defaultGuards: Guard[] = [
  blockedGuard,
  duplicateGuard,
  sideEffectGuard,
  repetitionGuard,
  metaToolDedupGuard,
];

// ─── Pipeline Runner ──────────────────────────────────────────────────────────

/**
 * Builds a guard-check function from a guard pipeline.
 * Guards run in order; first failure short-circuits.
 *
 * @example
 * // Standard usage
 * const check = checkToolCall(defaultGuards);
 *
 * // Strategy-specific: skip repetition guard
 * const check = checkToolCall([blockedGuard, duplicateGuard, sideEffectGuard]);
 */
export function checkToolCall(guards: Guard[]) {
  return (tc: ToolCallSpec, state: KernelState, input: ReActKernelInput): GuardOutcome => {
    for (const guard of guards) {
      const outcome = guard(tc, state, input);
      if (!outcome.pass) return outcome;
    }
    return { pass: true };
  };
}
