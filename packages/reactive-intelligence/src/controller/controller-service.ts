import { Context, Effect, Layer } from "effect";
import type { ControllerDecision, ReactiveControllerConfig, ControllerEvalParams } from "../types.js";
import { evaluateEarlyStop } from "./early-stop.js";
import { evaluateStrategySwitch } from "./strategy-switch.js";
import { evaluateCompression } from "./context-compressor.js";
import { evaluateTempAdjust } from "./evaluators/temp-adjust.js";
import { evaluateSkillActivate } from "./evaluators/skill-activate.js";
import { evaluateToolInject } from "./evaluators/tool-inject.js";
import { evaluateToolFailureStreak } from "./evaluators/tool-failure-streak.js";
import { evaluateStallDetect } from "./evaluators/stall-detect.js";

// ─── Pruned evaluators (North Star principle 11 / WS-4 Phase 2 — 2026-05-28) ───
//
// `evaluatePromptSwitch`, `evaluateMemoryBoost`, `evaluateSkillReinject`,
// `evaluateHumanEscalate` were originally registered as advisory-only
// ControllerDecisions with no dispatch handler. They produced telemetry
// noise and burned evaluator cycles every iteration without ever causing
// an action.
//
// First removed from the evaluate chain; the evaluator source files were
// kept under `evaluators/` for recoverability. WS-4 Phase 2 (master plan
// §3.6 RC-3 / anti-mission #6) completed the prune: the 4 evaluator files
// AND their ControllerDecision union members are deleted. Re-introduce
// only when a real dispatch handler ships alongside.

export class ReactiveControllerService extends Context.Tag("ReactiveControllerService")<
  ReactiveControllerService,
  {
    readonly evaluate: (params: ControllerEvalParams) => Effect.Effect<readonly ControllerDecision[]>;
  }
>() {}

export const ReactiveControllerServiceLive = (
  _config: ReactiveControllerConfig,
): Layer.Layer<ReactiveControllerService> =>
  Layer.succeed(ReactiveControllerService, {
    evaluate: (params) =>
      Effect.sync(() => {
        const decisions: ControllerDecision[] = [];
        // Early-stop evaluator (Task 2A)
        if (params.config.earlyStop) {
          const earlyStop = evaluateEarlyStop(params);
          if (earlyStop) decisions.push(earlyStop);
        }
        // Strategy-switch evaluator (Task 2D)
        if (params.config.strategySwitch) {
          const strategySwitch = evaluateStrategySwitch(params);
          if (strategySwitch) decisions.push(strategySwitch);
        }
        // Context-compression evaluator (Task 2C)
        if (params.config.contextCompression) {
          const compression = evaluateCompression(params);
          if (compression) decisions.push(compression);
        }
        // ─── Living Intelligence evaluators (handler-backed only) ───
        const tempAdj = evaluateTempAdjust(params);
        if (tempAdj) decisions.push(tempAdj);

        const skillAct = evaluateSkillActivate(params);
        if (skillAct) decisions.push(skillAct);

        const toolInj = evaluateToolInject(params);
        if (toolInj) decisions.push(toolInj);

        const toolFailure = evaluateToolFailureStreak(params);
        if (toolFailure) decisions.push(toolFailure);

        const stall = evaluateStallDetect(params);
        if (stall) decisions.push(stall);

        return decisions;
      }),
  });
