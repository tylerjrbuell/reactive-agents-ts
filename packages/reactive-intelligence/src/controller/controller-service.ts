import { Context, Effect, Layer } from "effect";
import type { ControllerDecision, ReactiveControllerConfig, ControllerEvalParams } from "../types.js";
import { evaluateEarlyStop } from "./early-stop.js";

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
        // Additional evaluators will be wired in Tasks 2B-4
        return decisions;
      }),
  });
