import { Context, Effect, Layer } from "effect";
import type { ControllerDecision, ReactiveControllerConfig, ControllerEvalParams } from "../types.js";

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
        // Individual evaluators will be wired in Tasks 2-4
        return decisions;
      }),
  });
