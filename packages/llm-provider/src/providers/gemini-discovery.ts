// packages/llm-provider/src/providers/gemini-discovery.ts
//
// Gemini capability discoverer: asks the Gemini API's models.get for a model
// the static table does not list, and reports its limits.
//
// models.get fields (ai.google.dev/api/models, verified live 2026-11-19 on
// gemini-4-carbon, gemini-4-argon, gemma-4-26b-a4b-it):
//   inputTokenLimit  -> maxContextTokens (also recommendedNumCtx)
//   outputTokenLimit -> maxOutputTokens
//   thinking         -> supportsThinkingMode (Gemma ids are forced off by the
//                       resolver's Gemma rule: they reject thinkingConfig)
// Tier is not reported; capabilityFromReported assigns its "mid" placeholder.

import { Effect, Option } from "effect";
import type { ReportedModelMetadata } from "../capability-reported.js";
import type { CapabilityDiscoverer } from "../capability-discovery.js";
import { discoverReported, positiveInt } from "./discovery-common.js";

/** The models.get fields discovery reads. */
export interface GeminiModelInfo {
  readonly inputTokenLimit?: number;
  readonly outputTokenLimit?: number;
  readonly thinking?: boolean;
}

/** One models.get request. `signal` aborts it when discovery times out. */
export type GeminiModelGet = (req: {
  readonly apiKey: string;
  readonly model: string;
  readonly signal: AbortSignal;
}) => Promise<GeminiModelInfo>;

type GoogleGenAIModule = {
  GoogleGenAI: new (opts: { apiKey?: string }) => {
    models: {
      get: (params: { model: string; config?: { abortSignal?: AbortSignal } }) => Promise<GeminiModelInfo>;
    };
  };
};

/** models.get through `@google/genai`, loaded lazily like the provider does. */
const sdkModelGet: GeminiModelGet = async ({ apiKey, model, signal }) => {
  const { GoogleGenAI } = (await import("@google/genai")) as GoogleGenAIModule;
  return new GoogleGenAI({ apiKey }).models.get({ model, config: { abortSignal: signal } });
};

/**
 * Build the Gemini discoverer.
 *
 * Skips the request when an answer already exists: a static row (it overrides
 * discovery) or reported metadata (from an earlier discovery or the model
 * listing). Without an API key (`ctx.apiKey`, then `GOOGLE_API_KEY`) it asks
 * nothing.
 *
 * @param get — models.get implementation; defaults to the `@google/genai` SDK
 */
export const makeGeminiCapabilityDiscoverer =
  (get: GeminiModelGet = sdkModelGet): CapabilityDiscoverer =>
  (model, ctx) =>
    discoverReported("gemini", model, () => {
      const apiKey = ctx.apiKey ?? process.env.GOOGLE_API_KEY;
      if (apiKey === undefined || apiKey.length === 0) {
        return Effect.succeed(Option.none<ReportedModelMetadata>());
      }
      const id = model.replace(/^models\//, "");
      return Effect.tryPromise({
        try: (signal) => get({ apiKey, model: id, signal }),
        catch: (cause) => cause,
      }).pipe(
        Effect.map((info): Option.Option<ReportedModelMetadata> => {
          const maxContextTokens = positiveInt(info.inputTokenLimit);
          if (maxContextTokens === undefined) return Option.none();
          const maxOutputTokens = positiveInt(info.outputTokenLimit);
          return Option.some({
            maxContextTokens,
            ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
            ...(typeof info.thinking === "boolean" ? { supportsThinkingMode: info.thinking } : {}),
          });
        }),
      );
    });
