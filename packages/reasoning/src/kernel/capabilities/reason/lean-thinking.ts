/**
 * Think phase — lean thinking (harness switch `leanThinking`, default OFF).
 *
 * Local-model campaign P2a/P2b: thinking models (qwen3, deepseek-r1) spend most
 * of a tool-selection turn's wall clock inside hidden reasoning. qwen3:14b lost
 * 12 of 36 cells and r1 21 of 36 to the 150 s cell cap, `think` calls summing
 * 2,691 s and 5,479 s. Picking which listed tool to call, while a required tool
 * is still outstanding, does not need a reasoning chain.
 *
 * A turn is a tool-selection turn when ALL of these hold (deterministic, read
 * from existing state only):
 *  - the switch is on and the resolved model runs a thinking mode
 *    (`profile.thinkingModel`);
 *  - the provider is Ollama. The thinking switch is a latency lever there. Paid
 *    tiers keep their reasoning (the same cost-optimized scoping act-or-answer's
 *    `"auto"` uses); widen by ablation, not by default;
 *  - native function calling, tools were not withheld, a domain tool is on the
 *    wire;
 *  - tool work is outstanding ({@link outstandingToolWork}): the turn must act;
 *  - the last tool result did not fail ({@link lastToolCallFailed}): after a
 *    failure the model may need to reason about a change of approach.
 *
 * Such a turn's request carries `thinking: false` (CompletionRequest override;
 * Ollama sends `think: false` on capable models). The output budget is left
 * as is: the only variable is whether the model reasons. The existing
 * thinking-runaway recovery (thinking-runaway.ts) is untouched and still
 * fires on any turn that runs away. Boolean only: llm-provider has no
 * per-turn thinking-token budget, so a numeric budget needs that interface first.
 *
 * Record: one `guard-fired` event per decision (`guard: "lean-thinking"`,
 * outcome `redirect`, `metadata.thinking: false`). No step, no veto, nothing
 * the exit gate or arbitrator reads: this changes only how a turn is requested.
 */
import { Effect } from "effect";
import { emitGuardFired } from "../../utils/diagnostics.js";
import type { KernelContext, KernelState } from "../../state/kernel-state.js";
import { lastToolCallFailed, outstandingToolWork } from "./act-or-answer.js";

/** Guard name on every lean-thinking record. */
export const LEAN_THINKING_GUARD = "lean-thinking";

/** The deterministic facts {@link shouldThinkLean} decides from. */
export interface LeanThinkingFacts {
  readonly enabled: boolean;
  readonly thinkingModel: boolean;
  readonly providerName: string | undefined;
  readonly nativeFC: boolean;
  readonly toolsWithheld: boolean;
  readonly domainToolsOnWire: number;
  readonly outstanding: readonly string[];
  readonly afterFailedCall: boolean;
}

/** True when this turn's request should carry `thinking: false`. Pure. */
export function shouldThinkLean(t: LeanThinkingFacts): boolean {
  return (
    t.enabled &&
    t.thinkingModel &&
    t.providerName === "ollama" &&
    t.nativeFC &&
    !t.toolsWithheld &&
    t.domainToolsOnWire > 0 &&
    t.outstanding.length > 0 &&
    !t.afterFailedCall
  );
}

/** Inputs think.ts passes once per turn. */
export interface LeanThinkingTurn {
  readonly state: KernelState;
  readonly context: KernelContext;
  readonly enabled: boolean;
  readonly toolsWithheld: boolean;
  readonly domainToolsOnWire: number;
}

/**
 * Decide, before the call, whether this turn runs with thinking off. `false`
 * = send the request unchanged. Cheap gates first: the delivery check runs
 * only when the switch is on for a thinking model on native FC.
 */
export function decideLeanThinking(turn: LeanThinkingTurn) {
  return Effect.gen(function* () {
    const { state, context, enabled } = turn;
    if (!enabled || context.profile.thinkingModel !== true || context.toolCallingDriver.mode !== "native-fc") return false;
    const outstanding = outstandingToolWork(state, context.input);
    const lean = shouldThinkLean({
      enabled,
      thinkingModel: true,
      providerName: context.input.providerName,
      nativeFC: true,
      toolsWithheld: turn.toolsWithheld,
      domainToolsOnWire: turn.domainToolsOnWire,
      outstanding,
      afterFailedCall: lastToolCallFailed(state.steps),
    });
    if (lean) {
      yield* emitGuardFired({
        taskId: state.taskId,
        iteration: state.iteration,
        guard: LEAN_THINKING_GUARD,
        outcome: "redirect",
        reason: "tool-selection-turn",
        metadata: { thinking: false, outstanding },
      });
    }
    return lean;
  });
}
