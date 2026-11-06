import { Context, Effect, Layer } from "effect";
import type { ControllerOutput, ReactiveControllerConfig, ControllerEvalParams } from "../types.js";
import { evaluateEarlyStop } from "./early-stop.js";
import { evaluateStrategySwitch } from "./strategy-switch.js";
import { evaluateToolFailureStreak } from "./evaluators/tool-failure-streak.js";

// ─── Pruned evaluators ───
//
// WS-4 Phase 2 (2026-05-28) deleted four advisory-only evaluators that had no
// dispatch handler (prompt-switch, memory-boost, skill-reinject, human-escalate).
// The RI controller census (2026-11-06) deleted six more that never changed a
// run: temp-adjust, compress, skill-activate, tool-inject, stall-detect (and the
// producer-less harness-harm handler). Re-introduce an evaluator only with a
// handler whose effect reaches the model, and evidence that it fires.

export class ReactiveControllerService extends Context.Tag("ReactiveControllerService")<
  ReactiveControllerService,
  {
    /**
     * Run the evaluators. Returns interventions (`ControllerDecision`, for the
     * dispatcher) and notices (`ControllerNotice`, trace-only — filter them
     * out with `isControllerNotice` before dispatch).
     */
    readonly evaluate: (params: ControllerEvalParams) => Effect.Effect<readonly ControllerOutput[]>;
  }
>() {}

export const ReactiveControllerServiceLive = (
  _config: ReactiveControllerConfig,
): Layer.Layer<ReactiveControllerService> =>
  Layer.succeed(ReactiveControllerService, {
    evaluate: (params) =>
      Effect.sync(() => {
        const decisions: ControllerOutput[] = [];
        if (params.config.earlyStop) {
          const earlyStop = evaluateEarlyStop(params);
          if (earlyStop) decisions.push(earlyStop);
        }
        if (params.config.strategySwitch) {
          const strategySwitch = evaluateStrategySwitch(params);
          if (strategySwitch) decisions.push(strategySwitch);
        }
        const toolFailure = evaluateToolFailureStreak(params);
        if (toolFailure) decisions.push(toolFailure);

        return decisions;
      }),
  });
