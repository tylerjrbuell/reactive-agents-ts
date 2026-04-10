import { Effect, Layer } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";
import type { VerificationConfig, VerificationLLM } from "./types.js";
import { defaultVerificationConfig } from "./types.js";
import { VerificationService, VerificationServiceLive, makeVerificationService } from "./verification-service.js";

export const createVerificationLayer = (config?: Partial<VerificationConfig>, llm?: VerificationLLM) =>
  VerificationServiceLive({
    ...defaultVerificationConfig,
    ...config,
  }, llm);

/**
 * Verification layer that bridges the runtime's `LLMService` into tier-2 verification
 * (semantic entropy, fact decomposition, multi-source, hallucination LLM paths).
 * Requires `LLMService` to be provided by the merged runtime (same as memory/reasoning).
 */
export const createVerificationLayerWithRuntimeLlm = (
  config?: Partial<VerificationConfig>,
) =>
  Layer.effect(
    VerificationService,
    Effect.gen(function* () {
      const llm = yield* LLMService;
      const merged: VerificationConfig = {
        ...defaultVerificationConfig,
        ...config,
        useLLMTier: true,
      };
      const adapter: VerificationLLM = {
        complete: (req) =>
          llm.complete(req).pipe(
            Effect.map((r) => ({
              content: r.content,
              usage: r.usage ? { totalTokens: r.usage.totalTokens } : undefined,
            })),
          ),
        embed: (texts, model) => llm.embed(texts, model),
      };
      return makeVerificationService(merged, adapter);
    }),
  );
