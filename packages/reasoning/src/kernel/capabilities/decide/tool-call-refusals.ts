/**
 * Refused tool calls — every call the tool gate keeps out of Act is recorded.
 *
 * `gateNativeToolCallsForRequiredTools` (tool-gating.ts) keeps calls out of a
 * turn for several rules: a used-up `maxCallsPerTool` budget, required-tool
 * steering (only calls toward a missing required tool run), the
 * relevant-tools filter, the one-exploratory-call limit, single-step mode and
 * strict dependency mode. Before this module those calls vanished: no event,
 * nothing in the thread, so the model re-emitted them (H3 at 77b6d6122,
 * `harness:tool-call-dropped` 1→8, trace 01M6PZXKTQ702MXMXRJ1662NDN).
 *
 * For each refused call this module records:
 *   - a `guard-fired` event (`guard: "tool-gate"`, `outcome: "block"`);
 *   - an action step plus a guard observation step (`GUARD_OBSERVATION_TAG`,
 *     so the ledger marks the result `harnessAuthored` and it never counts as
 *     tool evidence), carrying an `intervention` stamped with the iteration;
 *   - a `tool_result` answering the call in the provider thread, so the next
 *     think turn sees "<tool> was not run: <reason>" for that exact call.
 *
 * The thread entry is built from the steps (`refusedCallsOfTurn`) on both
 * paths: Act's conversation assembly adds it next to the calls that ran, and
 * a turn with no call left to run adds it here (`recordRefusedTurn`).
 */
import { Effect } from "effect";
import type { ToolCallSpec } from "@reactive-agents/tools";
import { transitionState, type KernelState, type KernelInput, type KernelMessage } from "../../state/kernel-state.js";
import type { ReasoningStep } from "../../../types/index.js";
import { blockedCallSteps } from "../../utils/observation-helpers.js";
import { emitGuardFired } from "../../utils/diagnostics.js";
import { TOOL_GATE_ACTOR } from "../../state/kernel-constants.js";
import { gateNativeToolCallsForRequiredTools, type GateRefusal, type QuotaBudgetConflict } from "./tool-gating.js";

/** The intervention actor and guard-fired name of a gate refusal. */
export { TOOL_GATE_ACTOR };

/** The model-facing text of one refusal. */
export const refusalText = (r: GateRefusal<ToolCallSpec>): string => `${r.call.name} was not run: ${r.reason}`;

/** The action + guard-observation step pair for each refusal, in call order. */
export function refusalSteps(refused: readonly GateRefusal<ToolCallSpec>[], iteration: number): ReasoningStep[] {
  return refused.flatMap((r) =>
    blockedCallSteps(r.call, refusalText(r), false, {
      guard: true,
      intervention: {
        actor: TOOL_GATE_ACTOR,
        authorityClass: "deterministic",
        evidence: r.kind,
        whatChanged: `${r.call.name} call not executed`,
        iter: iteration,
      },
    }),
  );
}

/** One `guard-fired` event per refusal. */
export function emitRefusals(
  taskId: string,
  iteration: number,
  refused: readonly GateRefusal<ToolCallSpec>[],
): Effect.Effect<void, never> {
  return Effect.forEach(
    refused,
    (r) =>
      emitGuardFired({
        taskId,
        iteration,
        guard: TOOL_GATE_ACTOR,
        outcome: "block",
        reason: refusalText(r),
        metadata: { toolName: r.call.name, toolCallId: r.call.id, kind: r.kind },
      }),
    { discard: true },
  );
}

/** The gate's verdict for a turn plus the steps recording its refusals. */
export interface GatedTurn {
  readonly effective: readonly ToolCallSpec[];
  readonly blockedOptionalBatch: boolean;
  /** Required-call quotas `maxCallsPerTool` makes impossible (the run fails). */
  readonly quotaBudgetConflict?: readonly QuotaBudgetConflict[];
  readonly refused: readonly GateRefusal<ToolCallSpec>[];
  readonly refusalSteps: readonly ReasoningStep[];
}

/**
 * Gate one turn's calls (run-wide counts: `maxCallsPerTool` is a run budget)
 * and emit a guard-fired event for every refusal.
 */
export function gateTurnToolCalls(
  state: KernelState,
  input: KernelInput,
  calls: readonly ToolCallSpec[],
): Effect.Effect<GatedTurn, never> {
  return Effect.gen(function* () {
    const gate = gateNativeToolCallsForRequiredTools(
      calls,
      input.requiredTools ?? [],
      state.toolsUsed,
      input.relevantTools,
      state.evidence.successfulCounts,
      input.maxCallsPerTool,
      input.requiredToolQuantities,
      input.strictToolDependencyChain,
      input.nextMovesPlanning,
    );
    yield* emitRefusals(state.taskId, state.iteration, gate.refused);
    return { ...gate, refusalSteps: refusalSteps(gate.refused, state.iteration) };
  });
}

/** A refused call and the text answering it, read back from the steps. */
export interface RefusedCall {
  readonly call: { readonly id: string; readonly name: string; readonly arguments: Record<string, unknown> };
  readonly content: string;
}

const answeredCallIds = (messages: readonly KernelMessage[]): ReadonlySet<string> =>
  new Set(messages.flatMap((m) => (m.role === "tool_result" ? [m.toolCallId] : [])));

/**
 * The calls the gate refused at `iteration`, in step order. Calls already
 * answered in `messages` are skipped, so the thread never carries a call twice.
 */
export function refusedCallsOfTurn(
  steps: readonly ReasoningStep[],
  iteration: number,
  messages: readonly KernelMessage[] = [],
): readonly RefusedCall[] {
  const answered = answeredCallIds(messages);
  const actions = new Map(
    steps.flatMap((s) => (s.type === "action" && s.metadata?.toolCall ? [[s.metadata.toolCall.id, s.metadata.toolCall] as const] : [])),
  );
  return steps.flatMap((s) => {
    const i = s.metadata?.intervention;
    const id = s.metadata?.toolCallId;
    if (s.type !== "observation" || i?.actor !== TOOL_GATE_ACTOR || i.iter !== iteration || id === undefined) return [];
    const call = actions.get(id);
    return call && !answered.has(id) ? [{ call, content: s.content }] : [];
  });
}

/**
 * The `tool_result` messages answering refused calls. `refused` marks them so
 * failure counters (reflect/tool-failure-streak.ts) do not read a refusal as a
 * tool failure (H3 at 6a6a7f4d5: five refusals early-stopped a correct run).
 */
export const refusalResults = (refused: readonly RefusedCall[]): KernelMessage[] =>
  refused.map((r) => ({ role: "tool_result", toolCallId: r.call.id, toolName: r.call.name, content: r.content, isError: true, refused: true }));

/**
 * Add a turn's refusals to a state that does not go through Act (every call
 * refused, or a strict-mode redirect): the steps, then an assistant message
 * carrying the refused calls and one `tool_result` per call.
 */
export function recordRefusedTurn(next: KernelState, thought: string, gated: GatedTurn): KernelState {
  if (gated.refused.length === 0) return next;
  const steps = [...next.steps, ...gated.refusalSteps];
  const answered = answeredCallIds(next.messages);
  const refused = gated.refused
    .filter((r) => !answered.has(r.call.id))
    .map((r): RefusedCall => ({ call: { id: r.call.id, name: r.call.name, arguments: r.call.arguments }, content: refusalText(r) }));
  if (refused.length === 0) return transitionState(next, { steps });
  const assistant: KernelMessage = { role: "assistant", content: thought, toolCalls: refused.map((r) => r.call) };
  return transitionState(next, { steps, messages: [...next.messages, assistant, ...refusalResults(refused)] });
}
