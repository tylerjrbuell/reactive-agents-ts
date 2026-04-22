import { Context, Effect, Layer } from "effect";
import type { ControllerDecision, ReactiveControllerConfig, ControllerEvalParams } from "../types.js";
import { evaluateEarlyStop } from "./early-stop.js";
import { evaluateStrategySwitch } from "./strategy-switch.js";
import { evaluateCompression } from "./context-compressor.js";
import { evaluateTempAdjust } from "./evaluators/temp-adjust.js";
import { evaluateSkillActivate } from "./evaluators/skill-activate.js";
import { evaluatePromptSwitch } from "./evaluators/prompt-switch.js";
import { evaluateToolInject } from "./evaluators/tool-inject.js";
import { evaluateMemoryBoost } from "./evaluators/memory-boost.js";
import { evaluateSkillReinject } from "./evaluators/skill-reinject.js";
import { evaluateHumanEscalate } from "./evaluators/human-escalate.js";
import { evaluateToolFailureStreak } from "./evaluators/tool-failure-streak.js";
import { evaluateStallDetect } from "./evaluators/stall-detect.js";

export class ReactiveControllerService extends Context.Tag("ReactiveControllerService")<
  ReactiveControllerService,
  {
    readonly evaluate: (params: ControllerEvalParams) => Effect.Effect<readonly ControllerDecision[]>;
  }
>() {}

export const ReactiveControllerServiceLive = (
  config: ReactiveControllerConfig,
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
        // ─── Living Intelligence evaluators ───
        const tempAdj = evaluateTempAdjust(params);
        if (tempAdj) decisions.push(tempAdj);

        const skillAct = evaluateSkillActivate(params);
        if (skillAct) decisions.push(skillAct);

        const promptSw = evaluatePromptSwitch(params);
        if (promptSw) decisions.push(promptSw);

        const toolInj = evaluateToolInject(params);
        if (toolInj) decisions.push(toolInj);

        const memBoost = evaluateMemoryBoost(params);
        if (memBoost) decisions.push(memBoost);

        const skillReinj = evaluateSkillReinject(params);
        if (skillReinj) decisions.push(skillReinj);

        const humanEsc = evaluateHumanEscalate(params);
        if (humanEsc) decisions.push(humanEsc);

        const toolFailure = evaluateToolFailureStreak(params);
        if (toolFailure) decisions.push(toolFailure);

        const stall = evaluateStallDetect(params);
        if (stall) decisions.push(stall);

        return decisions;
      }),
  });
