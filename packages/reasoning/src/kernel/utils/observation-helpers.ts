/**
 * observation-helpers.ts — Pure observation helpers extracted from
 * act/tool-execution.ts in WS-3 Phase 3 (cycle 2 closure).
 *
 * `makeObservationResult` is a pure, deterministic builder for ObservationResult
 * values. It has no Effect/LLMService/kernel-state coupling, so it belongs in
 * `kernel/utils/` (substrate) rather than the Act capability. Living here lets
 * Reason capability (think.ts, think-guards.ts) construct observations without
 * importing Act, eliminating the reason → act cross-capability edge.
 *
 * Same extraction pattern as Phase 1's `tool-parsing.ts`.
 */
import type { ObservationResult } from "../../types/observation.js";
import type { ReasoningStep } from "../../types/index.js";
import {
  categorizeToolName,
  deriveResultKind,
  KNOWN_TRUSTED_TOOL_NAMES,
  GRANDFATHER_TRUST_JUSTIFICATION,
} from "../../types/observation.js";
import { GUARD_OBSERVATION_TAG, TOOL_GATE_ACTOR } from "../state/kernel-constants.js";
import { makeStep } from "../capabilities/sense/step-utils.js";

type StepIntervention = NonNullable<NonNullable<ReasoningStep["metadata"]>["intervention"]>;

/** True for the observation step answering a call the tool gate refused (it never ran). */
export const isToolGateRefusal = (step: ReasoningStep): boolean =>
  step.type === "observation" && step.metadata?.intervention?.actor === TOOL_GATE_ACTOR;

/**
 * True for an observation recording a failed tool result. A tool-gate refusal
 * is not a failure (the call never ran), so failure counters read this, not
 * `observationResult.success === false` directly.
 */
export const isFailedToolObservation = (step: ReasoningStep): boolean =>
  step.type === "observation" && step.metadata?.observationResult?.success === false && !isToolGateRefusal(step);

/**
 * The action + observation step pair for a call that did not execute (policy
 * block, guard block, tool-gate refusal): the action records the call, the
 * observation answers it with `text`. `guard` tags the observation
 * harness-authored (`GUARD_OBSERVATION_TAG`: never tool evidence); `toolUsed`
 * stamps the action's `toolUsed`.
 */
export function blockedCallSteps(
  call: { readonly id: string; readonly name: string; readonly arguments: Record<string, unknown> },
  text: string,
  success: boolean,
  opts: { readonly guard?: boolean; readonly toolUsed?: boolean; readonly intervention?: StepIntervention } = {},
): [ReasoningStep, ReasoningStep] {
  const { id, name, arguments: args } = call;
  return [
    makeStep("action", `${name}(${JSON.stringify(args)})`, {
      toolCall: { id, name, arguments: args },
      ...(opts.toolUsed ? { toolUsed: name } : {}),
    }),
    makeStep("observation", text, {
      toolCallId: id,
      ...(opts.guard ? { frameworkInstrumentation: GUARD_OBSERVATION_TAG } : {}),
      observationResult: makeObservationResult(name, success, text),
      ...(opts.intervention ? { intervention: opts.intervention } : {}),
    }),
  ];
}

/**
 * Build an ObservationResult from tool name + success flag + display text.
 */
export function makeObservationResult(
  toolName: string,
  success: boolean,
  displayText: string,
  options?: {
    readonly delegatedToolsUsed?: readonly string[];
    readonly childEnvelopes?: readonly NonNullable<ObservationResult["childEnvelopes"]>[number][];
  },
): ObservationResult {
  const category = categorizeToolName(toolName);
  const resultKind = deriveResultKind(category, success);
  const preserveOnCompaction = !success || category === "error";
  // Phase 1 S2.3 — derive trustLevel from KNOWN_TRUSTED_TOOL_NAMES set in
  // observation.ts. ContextCurator (S2.5) consumes this to decide whether
  // to render the observation inline or in a <tool_output> block.
  const isTrusted = KNOWN_TRUSTED_TOOL_NAMES.has(toolName);
  return {
    success,
    toolName,
    displayText,
    category,
    resultKind,
    preserveOnCompaction,
    ...(options?.delegatedToolsUsed && options.delegatedToolsUsed.length > 0
      ? { delegatedToolsUsed: [...new Set(options.delegatedToolsUsed)] }
      : {}),
    ...(options?.childEnvelopes && options.childEnvelopes.length > 0
      ? { childEnvelopes: [...options.childEnvelopes] }
      : {}),
    trustLevel: isTrusted ? "trusted" : "untrusted",
    ...(isTrusted ? { trustJustification: GRANDFATHER_TRUST_JUSTIFICATION } : {}),
  };
}
