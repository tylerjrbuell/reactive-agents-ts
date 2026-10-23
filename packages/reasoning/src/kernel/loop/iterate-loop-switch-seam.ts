/**
 * iterate-loop-switch-seam.ts — loop-detector strategy-switch EVALUATION,
 * decomposed VERBATIM from iterate-pass.ts (quality program Task 9 / GH #222;
 * formerly lines 1610-1656).
 *
 * Resolves WHICH strategy a confirmed loop should switch to: fallback-strategy
 * fast path, LLM evaluator for multi-candidate configs (W4.5), or the
 * deterministic ladder otherwise. The applyStrategySwitch CALL SITE stays in
 * iterate-pass.ts (control-plane grandfathering); the driver keeps the
 * "evaluating" status transition and the onStrategySwitchEvaluated hook.
 */
import { Effect } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";
import type { KernelInput, KernelRunOptions } from "../state/kernel-state.js";
import { evaluateStrategySwitch } from "../capabilities/reflect/strategy-evaluator.js";
import {
  KERNEL_STRATEGY_CANDIDATES,
  isDefaultCandidateSet,
  selectLadderStrategy,
} from "../capabilities/reflect/strategy-ladder.js";
import { transitionState, type KernelState } from "../../kernel/state/kernel-state.js";

/** The switch-evaluator verdict shape (matches the original inline annotation). */
export type LoopSwitchEvaluation = {
  shouldSwitch: boolean;
  recommendedStrategy: string;
  reasoning: string;
};

/** Decide whether/where to switch after a confirmed loop (former lines 1610-1656). */
export function resolveLoopSwitchEvaluation(args: {
  readonly state: KernelState;
  readonly switchCfg: NonNullable<KernelRunOptions["strategySwitching"]>;
  readonly currentInput: KernelInput;
  readonly triedStrategies: readonly string[];
}): Effect.Effect<LoopSwitchEvaluation, never, LLMService> {
  return Effect.gen(function* () {
    const { state, switchCfg, currentInput, triedStrategies } = args;

            let evaluation: { shouldSwitch: boolean; recommendedStrategy: string; reasoning: string };

            if (switchCfg.fallbackStrategy) {
              // Skip LLM evaluator — use fallback directly
              evaluation = {
                shouldSwitch: true,
                recommendedStrategy: switchCfg.fallbackStrategy,
                reasoning: "fallback strategy configured",
              };
            } else {
              // W4.5 — deterministic ladder by DEFAULT (zero LLM). The LLM
              // strategy-evaluator round-trip runs ONLY for a MULTI-CANDIDATE
              // config: an explicitly-supplied candidate set that is not the
              // canonical kernel set (the caller wants the model to choose among
              // its own candidates). Otherwise walk reactive → plan-execute-reflect
              // → reflexion deterministically.
              const candidates = switchCfg.availableStrategies ?? KERNEL_STRATEGY_CANDIDATES;
              const multiCandidate =
                switchCfg.availableStrategies !== undefined &&
                !isDefaultCandidateSet(switchCfg.availableStrategies);
              if (multiCandidate) {
                evaluation = yield* evaluateStrategySwitch(
                  state,
                  currentInput.task ?? "",
                  candidates,
                  triedStrategies,
                  // W2d 2.6 — the runtime already threads calibration onto the
                  // kernel input; low/skip reliability must skip this
                  // round-trip (documented behavior, previously unenforced —
                  // the live post-w1 S1 traces prove it fired on local arms).
                  { classifierReliability: currentInput.calibration?.classifierReliability },
                );
              } else {
                const next = selectLadderStrategy(triedStrategies, candidates);
                evaluation = next
                  ? {
                      shouldSwitch: true,
                      recommendedStrategy: next,
                      reasoning: `deterministic ladder → ${next}`,
                    }
                  : {
                      shouldSwitch: false,
                      recommendedStrategy: "",
                      reasoning: "no untried ladder strategy remains",
                    };
              }
            }
    return evaluation;
  });
}
