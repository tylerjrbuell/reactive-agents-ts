import { Effect, Layer } from "effect";
import { PromptService, PromptServiceLive } from "./services/prompt-service.js";
import { allBuiltinTemplates } from "./templates/all.js";

/**
 * Create a PromptService layer with all built-in templates pre-registered.
 */
export const createPromptLayer = (): Layer.Layer<PromptService> =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const prompts = yield* PromptService;
      for (const template of allBuiltinTemplates) {
        yield* prompts.register(template);
      }
    }),
  ).pipe(Layer.provide(PromptServiceLive), Layer.merge(PromptServiceLive));
