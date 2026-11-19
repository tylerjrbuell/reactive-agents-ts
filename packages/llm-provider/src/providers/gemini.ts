import { Effect, Layer, Stream, Schema, JSONSchema } from "effect";
import { LLMService } from "../llm-service.js";
import { LLMConfig } from "../llm-config.js";
import type { ProviderCapabilities } from "../capabilities.js";
import {
  LLMError,
  LLMTimeoutError,
} from "../errors.js";
import type { LLMErrors } from "../errors.js";
import { runStructuredParseWithRetry } from "../structured-parse-retry.js";
import { mapProviderError, resolveProviderApiKey } from "../provider-error.js";
import type {
  CompletionResponse,
  StreamEvent,
  LLMMessage,
} from "../types.js";
import { calculateCost, estimateTokenCount } from "../token-counter.js";
import { retryStreamBeforeFirstEmission, withRetryAndTimeout } from "../retry.js";
import { emitToolCallComplete } from "../streaming-helpers.js";
import { selectAdapter } from "../adapter.js";
import { deepClone, normalizeToolSchemaFor } from "../schema-utils.js";
import { resolveCapability } from "../capability-resolver.js";
import {
  resolveThinkingEnabled,
  reserveThinkingBudget,
  type ThinkingOptions,
} from "../thinking/index.js";
import { makeThoughtMarkerStripper, stripLeadingThoughtMarker } from "./gemini-thought-marker.js";
import { makeThinkingConfigFallback, warnThinkingConfigRetryOnce } from "./gemini-thinking-fallback.js";
import { clampOutputBudget } from "../params/output-budget.js";
import { resolveCloudTimeoutMs } from "../params/cloud-timeout.js";
import { mapStopReason, reportedStopReason } from "../params/stop-reason.js";
import { emitContentDegradations } from "../content-parts.js";
import { GEMINI_INPUT_MODALITIES, geminiContentPolicy, toGeminiContents } from "./gemini-messages.js";
import {
  makeThoughtSignatureStore,
  newGeminiToolCallId,
  rememberFunctionCallSignatures,
} from "./gemini-thought-signatures.js";
import { geminiToolConfigField } from "./tool-choice.js";
import type { ToolChoice } from "../tool-protocol.js";

// ─── Gemini Message Conversion ─── (./gemini-messages.ts)

const extractSystemPrompt = (
  messages: readonly LLMMessage[],
): string | undefined => {
  const sys = messages.find((m) => m.role === "system");
  if (!sys) return undefined;
  return typeof sys.content === "string" ? sys.content : undefined;
};

/** @internal Exported for testing only */
export const toGeminiTools = (
  tools: { name: string; description: string; inputSchema: Record<string, unknown> }[],
) =>
  tools.length === 0
    ? undefined
    : [
        {
          functionDeclarations: tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: normalizeToolSchemaFor(t.name, t.inputSchema),
          })),
        },
      ];

// ─── Gemini Response Types ───

type GeminiUsage = {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  /** Thinking-model reasoning tokens. Reported OUTSIDE candidatesTokenCount. */
  thoughtsTokenCount?: number;
  totalTokenCount?: number;
  cachedContentTokenCount?: number;
};

type GeminiFunctionCall = { name: string; args: unknown };

/** Response part fields read here; `thoughtSignature` rides function-call parts (Gemini 3). */
type GeminiResponsePart = {
  text?: string;
  thought?: boolean;
  functionCall?: GeminiFunctionCall;
  thoughtSignature?: string;
};

type GeminiRawResponse = {
  text: string;
  functionCalls?: GeminiFunctionCall[];
  usageMetadata?: GeminiUsage;
  candidates?: Array<{
    finishReason?: string;
    content?: { parts?: GeminiResponsePart[] };
  }>;
};

const NON_OK_FINISH_REASONS = new Set([
  "MAX_TOKENS",
  "SAFETY",
  "RECITATION",
  "BLOCKLIST",
  "PROHIBITED_CONTENT",
  "SPII",
  "LANGUAGE",
  "MALFORMED_FUNCTION_CALL",
  "UNEXPECTED_TOOL_CALL",
  "OTHER",
]);

const explainGeminiFinishReason = (reason: string): string => {
  switch (reason) {
    case "UNEXPECTED_TOOL_CALL":
      return "The model attempted to call a tool but no tools were declared in the request.";
    case "MALFORMED_FUNCTION_CALL":
      return "The model produced a malformed tool call.";
    case "MAX_TOKENS":
      return "The output token budget was exhausted before any visible text was emitted (likely consumed by thinking-mode reasoning). Increase maxTokens or set thinkingConfig.thinkingBudget.";
    case "SAFETY":
    case "BLOCKLIST":
    case "PROHIBITED_CONTENT":
    case "SPII":
    case "RECITATION":
      return "The response was blocked by Gemini content filters.";
    case "LANGUAGE":
      return "Gemini blocked the response due to an unsupported language.";
    default:
      return "Unexpected stream termination.";
  }
};

// ─── Response Mapper ───

const mapGeminiResponse = (
  response: GeminiRawResponse,
  model: string,
  registry?: Record<string, { readonly input: number; readonly output: number }>,
): CompletionResponse => {
  // M12 Hook 1/7 — give the calibrated/tier ProviderAdapter first crack at
  // normalizing tool calls (e.g., Gemini args-as-string variants). When the
  // adapter returns undefined or no calibration is registered for `model`,
  // fall through to the default Gemini-shaped extraction. Pattern mirrors
  // local.ts:440-465.
  const { adapter: providerAdapter } = selectAdapter(
    { supportsToolCalling: true },
    "frontier",
    model,
  );
  const adapterParsed = providerAdapter.parseToolCalls?.(response, model);
  const toolCalls = adapterParsed
    ? adapterParsed.map((tc, i) => ({
        // Gemini returns no call ids. Synthesized ids are unique per call:
        // thought signatures are keyed by them (gemini-thought-signatures.ts).
        id: newGeminiToolCallId(i),
        name: tc.name,
        input: tc.arguments,
      }))
    : response.functionCalls?.map((fc, i) => ({
        id: newGeminiToolCallId(i),
        name: fc.name,
        input: fc.args,
      }));

  // Absent count = unknown (undefined), never a measured 0.
  const inputTokens = response.usageMetadata?.promptTokenCount;
  // SDK (@google/genai UsageMetadata.totalTokenCount) = prompt + candidates +
  // toolUse + thoughts: thoughts sit OUTSIDE candidatesTokenCount, so output
  // is the sum. reasoningTokens is the thoughts subset of outputTokens.
  const reasoningTokens = response.usageMetadata?.thoughtsTokenCount;
  const candidatesTokens = response.usageMetadata?.candidatesTokenCount;
  const outputTokens =
    candidatesTokens === undefined ? undefined : candidatesTokens + (reasoningTokens ?? 0);

  return {
    content: stripLeadingThoughtMarker(response.text ?? ""),
    // Shared table-driven mapping — gemini's table is intentionally empty
    // (finishReason was never consulted here; non-OK reasons error out via
    // the W22 guard), so this preserves the original tool_use/end_turn shape.
    stopReason: toolCalls?.length
      ? "tool_use"
      : mapStopReason(response.candidates?.[0]?.finishReason, "gemini"),
    usage: {
      inputTokens,
      outputTokens,
      totalTokens: (inputTokens ?? 0) + (outputTokens ?? 0),
      // Cost is priced on the reported halves only.
      estimatedCost: calculateCost(
        inputTokens ?? 0,
        outputTokens ?? 0,
        model,
        {
          cached_content_token_count: response.usageMetadata?.cachedContentTokenCount,
        },
        registry,
      ),
      ...(typeof response.usageMetadata?.cachedContentTokenCount === "number"
        ? { cacheReadInputTokens: response.usageMetadata.cachedContentTokenCount }
        : {}),
      ...(typeof reasoningTokens === "number" ? { reasoningTokens } : {}),
    },
    model,
    toolCalls: toolCalls?.length ? toolCalls : undefined,
  };
};

// ─── Generation-config builder (exported @internal seam) ─────────────────────
//
// Applies the thinking opt-in contract so hidden reasoning can never starve the
// visible answer (Cluster A fix, now gated behind config.thinking instead of
// auto-enabled):
//
//  • undefined/false → thinkingConfig: { thinkingBudget: 0 } (best-effort
//    disable). gemini-2.5-pro treats budget 0 as ADVISORY and may still think
//    internally; the Cluster-B non-OK-empty guard covers that edge case.
//  • true + capable → reserve = clamp(answerBudget*4, 1024, 16384) ON TOP;
//    maxOutputTokens = answerBudget + reserve so the answer always has room.
//
// The function is a pure config builder with no SDK or Layer dependencies,
// making it directly unit-testable without Effect or network calls.

type GeminiConfigOpts = {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  stopSequences?: readonly string[];
  tools?: readonly { name: string; description: string; inputSchema: Record<string, unknown> }[];
  responseMimeType?: string;
  responseSchema?: Record<string, unknown>;
  /** Per-call `CompletionRequest.toolChoice`; `"required"` sets functionCallingConfig mode ANY. */
  toolChoice?: ToolChoice;
  /** Per-call `CompletionRequest.thinking`; overrides `configThinking` when set. */
  thinking?: boolean;
};

/**
 * Build a Gemini generation-config object with tri-state thinking applied.
 *
 * @internal – exported for unit testing only; use `GeminiProviderLive` in production.
 */
export const buildGenerationConfig = (
  opts: GeminiConfigOpts,
  configThinking: boolean | undefined,
  thinkingOptions: ThinkingOptions | undefined,
): Record<string, unknown> => {
  const model = opts.model ?? "";
  const answerBudget = opts.maxTokens ?? 4096;

  const cap = resolveCapability("gemini", model);
  const enabled = resolveThinkingEnabled(
    "gemini",
    model,
    configThinking,
    cap.supportsThinkingMode,
    opts.thinking,
  );
  const reserve = reserveThinkingBudget(answerBudget, cap.supportsThinkingMode, {
    ...(thinkingOptions ?? {}),
    enabled,
  });

  const cfg: Record<string, unknown> = {
    // F1: clamp the final wire value (answer + thinking reserve) against the
    // model's authoritative output ceiling. Single wire-assembly point for
    // complete/stream/completeStructured.
    maxOutputTokens: clampOutputBudget(
      reserve !== undefined ? answerBudget + reserve : answerBudget,
      cap,
    ),
    temperature: opts.temperature,
  };

  // thinkingConfig only for thinking-capable models (budget 0 = best-effort
  // disable). Models without thinking support (Gemma, image/TTS) reject the
  // field with HTTP 400, so it is omitted (gemini-thinking-fallback.ts).
  if (cap.supportsThinkingMode) cfg.thinkingConfig = { thinkingBudget: reserve ?? 0 };

  if (opts.systemPrompt) cfg.systemInstruction = opts.systemPrompt;
  if (opts.stopSequences?.length) cfg.stopSequences = [...opts.stopSequences];
  if (opts.tools?.length) cfg.tools = toGeminiTools([...opts.tools]);
  Object.assign(cfg, geminiToolConfigField(opts));
  if (opts.responseMimeType) cfg.responseMimeType = opts.responseMimeType;
  if (opts.responseSchema) cfg.responseSchema = opts.responseSchema;

  return cfg;
};

// ─── Gemini Provider Layer ───

const GEMINI_DEFAULT_MODEL = "gemini-2.5-flash";

export const GeminiProviderLive = Layer.effect(
  LLMService,
  Effect.gen(function* () {
    const config = yield* LLMConfig;
    // `.withProvider("gemini", { apiKey })` wins over GOOGLE_API_KEY.
    const key = resolveProviderApiKey(config.providerConfig, config.googleApiKey);
    const toEffectError = (error: unknown, model?: string): LLMErrors =>
      mapProviderError(error, "gemini", model, key.source);
    // Thought signatures Gemini returned, keyed by the tool-call ids this
    // instance generated; replayed on later requests (gemini-thought-signatures.ts).
    const signatures = makeThoughtSignatureStore();
    const thinkingFallback = makeThinkingConfigFallback(warnThinkingConfigRetryOnce);

    // ─── Lazy-load the SDK via dynamic import (interceptable by mock.module) ───

    type GeminiStreamChunk = {
      text: string;
      usageMetadata?: GeminiUsage;
      candidates?: Array<{
        finishReason?: string;
        content?: { parts?: GeminiResponsePart[] };
      }>;
      functionCalls?: GeminiFunctionCall[];
    };

    type GoogleGenAIClient = {
      models: {
        generateContent: (opts: unknown) => Promise<GeminiRawResponse>;
        generateContentStream: (opts: unknown) => Promise<AsyncIterable<GeminiStreamChunk>>;
        embedContent: (opts: unknown) => Promise<{
          embeddings: Array<{ values: number[] }>;
        }>;
      };
    };

    type GoogleGenAIModule = {
      GoogleGenAI: new (opts: { apiKey?: string }) => GoogleGenAIClient;
    };

    let _clientPromise: Promise<GoogleGenAIClient> | null = null;
    const getClient = (): Promise<GoogleGenAIClient> => {
      if (!_clientPromise) {
        _clientPromise = (
          import("@google/genai") as Promise<GoogleGenAIModule>
        ).then(({ GoogleGenAI }) => new GoogleGenAI({ apiKey: key.apiKey }));
      }
      return _clientPromise;
    };

    // Thin closure wrapper: merges config-level defaults then delegates to the
    // exported buildGenerationConfig seam which owns the thinking tri-state logic.
    const buildGeminiConfig = (opts: GeminiConfigOpts) =>
      buildGenerationConfig(
        {
          ...opts,
          maxTokens: opts.maxTokens ?? config.defaultMaxTokens,
          temperature: opts.temperature ?? config.defaultTemperature,
        },
        config.thinking,
        config.thinkingOptions,
      );

    return LLMService.of({
      complete: (request) => {
        // F4: one resolved binding drives BOTH Effect.timeout and the
        // timeoutMs restated in the error — the two can never drift.
        const timeoutMs = resolveCloudTimeoutMs(request, config);
        return Effect.gen(function* () {
          const client = yield* Effect.promise(() => getClient());
          let model = typeof request.model === 'string' 
            ? request.model 
            : request.model?.model ?? config.defaultModel;
          // If using non-Gemini default (e.g., Anthropic), fall back to Gemini default
          if (!model || model.startsWith("claude") || model.startsWith("gpt-")) {
            model = GEMINI_DEFAULT_MODEL;
          }
          const { contents, degraded } = toGeminiContents(
            request.messages,
            geminiContentPolicy(model),
            signatures.lookup,
          );
          yield* emitContentDegradations("gemini", model, degraded);
          const systemPrompt =
            extractSystemPrompt(request.messages) ?? request.systemPrompt;

          const response = yield* Effect.tryPromise({
            try: () =>
              thinkingFallback.run(
                model,
                buildGeminiConfig({
                  model,
                  maxTokens: request.maxTokens,
                  temperature: request.temperature,
                  systemPrompt,
                  stopSequences: request.stopSequences,
                  tools: request.tools,
                  toolChoice: request.toolChoice,
                  thinking: request.thinking,
                }),
                (cfg) => client.models.generateContent({ model, contents, config: cfg }),
              ),
            catch: toEffectError,
          });

          // Mirror the streaming path: don't paper over non-OK finishReasons.
          // Without this guard, Gemini returns success+empty content when the
          // model wanted a tool but no tools were declared, or when the
          // safety filter trips, etc.
          const finishReason = response.candidates?.[0]?.finishReason;
          const hasContent = (response.text?.length ?? 0) > 0 || (response.functionCalls?.length ?? 0) > 0;
          if (finishReason && NON_OK_FINISH_REASONS.has(finishReason) && !hasContent) {
            return yield* Effect.fail(
              new LLMError({
                provider: "gemini",
                message: `Gemini response ended with finishReason=${finishReason} and no content. ${explainGeminiFinishReason(finishReason)}`,
              }),
            );
          }

          const mapped = mapGeminiResponse(response, model, config.pricingRegistry);
          rememberFunctionCallSignatures(
            signatures,
            response.candidates?.[0]?.content?.parts,
            (mapped.toolCalls ?? []).map((tc) => tc.id),
          );
          return mapped;
        }).pipe((effect) =>
          // G2 default is 120s: 30s was too tight for thinking-mode models —
          // a single reasoning-heavy complete() (e.g. tree-of-thought
          // expansion on gemini-2.5-pro) routinely needs >30s. F4 makes the
          // ceiling request/config-resolvable — see resolveCloudTimeoutMs.
          withRetryAndTimeout(effect, {
            timeoutMs,
            onTimeout: () =>
              new LLMTimeoutError({
                message: "LLM request timed out",
                provider: "gemini",
                timeoutMs,
              }),
          }),
        );
      },

      stream: (request) =>
        Effect.gen(function* () {
          let model = typeof request.model === 'string'
            ? request.model
            : request.model?.model ?? config.defaultModel;
          // If using non-Gemini default (e.g., Anthropic), fall back to Gemini default
          if (!model || model.startsWith("claude") || model.startsWith("gpt-")) {
            model = GEMINI_DEFAULT_MODEL;
          }
          const { contents, degraded } = toGeminiContents(
            request.messages,
            geminiContentPolicy(model),
            signatures.lookup,
          );
          yield* emitContentDegradations("gemini", model, degraded);
          const systemPrompt =
            extractSystemPrompt(request.messages) ?? request.systemPrompt;
          const cap = resolveCapability("gemini", model);
          // GH #238 — gate on CAPABILITY, not consent. Unlike anthropic (where
          // thinking can only arrive when the request opts in), Gemini's
          // thinkingBudget: 0 is ADVISORY — gemini-2.5-class models can still
          // emit `thought: true` parts on a stream that never opted in. Gating
          // on consent would keep silently swallowing that real reasoning.
          const streamThinkEnabled = cap.supportsThinkingMode;

          // M12 Hook 1/7 — adapter selection decided up-front. When the
          // adapter supplies parseToolCalls we SUPPRESS per-chunk
          // emitToolCallComplete and synthesize start+delta pairs after the
          // for-await loop, once the adapter has normalized the accumulated
          // tool calls. See anthropic.ts stream() for the canonical comment.
          const { adapter: streamAdapter } = selectAdapter(
            { supportsToolCalling: true },
            "frontier",
            model,
          );
          const useAdapterNormalization =
            typeof streamAdapter.parseToolCalls === "function";

          return retryStreamBeforeFirstEmission(Stream.async<StreamEvent, LLMErrors>((emit) => {
            void (async () => {
              try {
                const client = await getClient();
                const cfg = buildGeminiConfig({
                  model,
                  maxTokens: request.maxTokens,
                  temperature: request.temperature,
                  systemPrompt,
                  tools: request.tools,
                  toolChoice: request.toolChoice,
                  thinking: request.thinking,
                });
                if (process.env.RA_GEMINI_DEBUG === "1") {
                  process.stderr.write(`[gemini-debug] req model=${model} contents=${JSON.stringify(contents).slice(0,300)} sysLen=${cfg.systemInstruction ? String(cfg.systemInstruction).length : 0} maxOut=${cfg.maxOutputTokens} hasTools=${!!((cfg.tools as unknown[] | undefined)?.length)}\n`);
                }
                const stream = await thinkingFallback.run(model, cfg, (c) =>
                  client.models.generateContentStream({ model, contents, config: c }),
                );

                let fullContent = "";
                let accumulatedThinking = "";
                // Absent count = unknown (undefined), never a measured 0. A
                // stream that never carries usageMetadata emits no usage event.
                let inputTokens: number | undefined;
                let outputTokens: number | undefined;
                let usageReported = false;
                let cachedContentTokens: number | undefined;
                let reasoningTokens: number | undefined;
                let lastFinishReason: string | undefined;
                const accumulatedToolCalls: { id: string; name: string; input: unknown }[] = [];
                // Raw functionCalls captured for adapter normalization at
                // end-of-stream. Populated only when useAdapterNormalization.
                const rawFunctionCalls: GeminiFunctionCall[] = [];
                // Thought signature of each raw call (same index), re-keyed to
                // the normalized ids below.
                const rawSignatures: (string | undefined)[] = [];
                // gemini-2.5-flash sometimes leads visible text with a bare
                // "thought" line (model text, not a thought part) — see
                // gemini-thought-marker.ts. Single visible-text sink.
                const markerStripper = makeThoughtMarkerStripper();
                const emitVisibleRaw = (text: string): void => {
                  if (text.length === 0) return;
                  emit.single({ type: "text_delta", text });
                  fullContent += text;
                };
                const emitVisible = (text: string): void => emitVisibleRaw(markerStripper.push(text));

                for await (const chunk of stream) {
                  // Walk parts directly when present — Gemini-2.5-pro emits
                  // text + functionCall + thought parts mixed, and `chunk.text`
                  // strips function-call parts (logging a noisy SDK warning),
                  // while the legacy `chunk.functionCalls` accessor doesn't
                  // expose thought parts. Fall back to `chunk.text` +
                  // `chunk.functionCalls` when the SDK doesn't surface
                  // candidates (older SDK versions, lightweight mocks).
                  const parts = chunk.candidates?.[0]?.content?.parts ?? [];
                  const finishReason = chunk.candidates?.[0]?.finishReason;
                  if (finishReason) lastFinishReason = finishReason;

                  if (process.env.RA_GEMINI_DEBUG === "1") {
                    const u = chunk.usageMetadata as { candidatesTokenCount?: number; thoughtsTokenCount?: number } | undefined;
                    process.stderr.write(`[gemini-debug] chunk parts=${parts.length} cand=${u?.candidatesTokenCount ?? "-"} thoughts=${u?.thoughtsTokenCount ?? "-"} finish=${finishReason ?? "-"}\n`);
                    for (const [pi, p] of parts.entries()) {
                      const tag = (p as { thought?: boolean }).thought ? "thought" : (p as { functionCall?: unknown }).functionCall ? "functionCall" : "text";
                      process.stderr.write(`[gemini-debug]   part[${pi}] kind=${tag} text_len=${(p.text ?? "").length} preview="${(p.text ?? "").slice(0,80)}"\n`);
                    }
                  }

                  if (parts.length > 0) {
                    for (const part of parts) {
                      // GH #238 — thought parts route through the SAME
                      // thinking_delta StreamEvent local/anthropic emit,
                      // gated on model capability (streamThinkEnabled above,
                      // NOT consent — thinkingBudget 0 is advisory for
                      // gemini-2.5-class models). They never join
                      // fullContent: thinking is not visible content.
                      if ((part as { thought?: boolean }).thought) {
                        if (
                          streamThinkEnabled &&
                          typeof part.text === "string" &&
                          part.text.length > 0
                        ) {
                          emit.single({ type: "thinking_delta", thinking: part.text });
                          accumulatedThinking += part.text;
                        }
                        continue;
                      }
                      // Visible text
                      if (typeof part.text === "string" && part.text.length > 0) {
                        emitVisible(part.text);
                      }
                      // Tool call
                      const fc = part.functionCall;
                      if (fc && typeof fc.name === "string") {
                        const tcId = newGeminiToolCallId(accumulatedToolCalls.length);
                        accumulatedToolCalls.push({ id: tcId, name: fc.name, input: fc.args });
                        if (part.thoughtSignature !== undefined) signatures.remember(tcId, part.thoughtSignature);
                        if (useAdapterNormalization) {
                          rawFunctionCalls.push(fc);
                          rawSignatures.push(part.thoughtSignature);
                        } else {
                          emitToolCallComplete(emit, tcId, fc.name, fc.args);
                        }
                      }
                    }
                  } else {
                    // Fallback for chunks without candidates (older SDK or test mocks).
                    if (chunk.text && chunk.text.length > 0) {
                      emitVisible(chunk.text);
                    }
                    const fcs = chunk.functionCalls;
                    if (fcs && fcs.length > 0) {
                      for (const fc of fcs) {
                        const tcId = newGeminiToolCallId(accumulatedToolCalls.length);
                        accumulatedToolCalls.push({ id: tcId, name: fc.name, input: fc.args });
                        if (useAdapterNormalization) {
                          rawFunctionCalls.push(fc);
                          rawSignatures.push(undefined);
                        } else {
                          emitToolCallComplete(emit, tcId, fc.name, fc.args);
                        }
                      }
                    }
                  }

                  if (chunk.usageMetadata) {
                    usageReported = true;
                    inputTokens = chunk.usageMetadata.promptTokenCount;
                    // Thoughts sit OUTSIDE candidatesTokenCount (SDK totalTokenCount
                    // = prompt + candidates + toolUse + thoughts): output = sum.
                    // Absent candidates = unknown output; absent thoughts = none.
                    const chunkThoughts = (chunk.usageMetadata as GeminiUsage).thoughtsTokenCount;
                    reasoningTokens = typeof chunkThoughts === "number" ? chunkThoughts : undefined;
                    const candidates = chunk.usageMetadata.candidatesTokenCount;
                    outputTokens =
                      candidates === undefined ? undefined : candidates + (chunkThoughts ?? 0);
                    // Only overwrite when the chunk genuinely reports the
                    // field — collapsing "never reported" and "reported 0"
                    // into the same sentinel corrupts both the surfaced
                    // usage.cacheReadInputTokens field AND the cost calc
                    // below (a real 0 must stay distinguishable from
                    // absent, same rule mapGeminiResponse already applies).
                    const chunkCached = (chunk.usageMetadata as { cachedContentTokenCount?: number }).cachedContentTokenCount;
                    if (typeof chunkCached === "number") {
                      cachedContentTokens = chunkCached;
                    }
                  }
                }

                emitVisibleRaw(markerStripper.flush());

                // Adapter-normalized end-of-stream tool-call synthesis. Build
                // a synthetic Gemini response shape so the adapter sees the
                // same shape it sees in complete(), then replace
                // accumulatedToolCalls with the normalized list and emit
                // start+delta pairs.
                if (useAdapterNormalization && rawFunctionCalls.length > 0) {
                  const syntheticResponse: GeminiRawResponse = {
                    text: fullContent,
                    functionCalls: rawFunctionCalls,
                  };
                  const normalized = streamAdapter.parseToolCalls?.(
                    syntheticResponse,
                    model,
                  );
                  if (normalized && normalized.length > 0) {
                    // Reset accumulatedToolCalls to the normalized projection
                    // so content_complete reflects post-adapter shape.
                    accumulatedToolCalls.length = 0;
                    for (let i = 0; i < normalized.length; i++) {
                      const tc = normalized[i]!;
                      const tcId = newGeminiToolCallId(i);
                      const signature = rawSignatures[i];
                      if (signature !== undefined) signatures.remember(tcId, signature);
                      accumulatedToolCalls.push({
                        id: tcId,
                        name: tc.name,
                        input: tc.arguments,
                      });
                      emitToolCallComplete(emit, tcId, tc.name, tc.arguments);
                    }
                  } else {
                    // Adapter declined despite advertising parseToolCalls —
                    // fall back to raw events using the buffered functionCalls.
                    for (let i = 0; i < rawFunctionCalls.length; i++) {
                      const fc = rawFunctionCalls[i]!;
                      const tc = accumulatedToolCalls[i];
                      if (tc) {
                        emitToolCallComplete(emit, tc.id, fc.name, fc.args);
                      }
                    }
                  }
                }

                // Surface non-OK finishReasons explicitly. Without this, Gemini
                // returns success+empty when the model wanted a tool but no
                // tools were available (UNEXPECTED_TOOL_CALL), or when the
                // safety filter trips, or when the budget is exhausted before
                // any visible text is emitted.
                if (
                  lastFinishReason &&
                  NON_OK_FINISH_REASONS.has(lastFinishReason) &&
                  accumulatedToolCalls.length === 0 &&
                  fullContent.length === 0
                ) {
                  emit.single({
                    type: "error",
                    error: `Gemini stream ended with finishReason=${lastFinishReason} and no content. ${explainGeminiFinishReason(lastFinishReason)}`,
                  } as StreamEvent);
                  return;
                }

                const hasToolCalls = accumulatedToolCalls.length > 0;
                // GH #238 — attach the accumulated thinking to the terminal
                // event (symmetry with anthropic.ts + the thinking_delta
                // passthrough above).
                emit.single({
                  type: "content_complete",
                  content: fullContent,
                  ...(hasToolCalls ? { stopReason: "tool_use", toolCalls: accumulatedToolCalls } : {}),
                  ...(streamThinkEnabled && accumulatedThinking.length > 0
                    ? { thinking: accumulatedThinking }
                    : {}),
                } as StreamEvent);
                if (usageReported) {
                  emit.single({
                    type: "usage",
                    usage: {
                      inputTokens,
                      outputTokens,
                      totalTokens: (inputTokens ?? 0) + (outputTokens ?? 0),
                      // Cost is priced on the reported halves only.
                      estimatedCost: calculateCost(
                        inputTokens ?? 0,
                        outputTokens ?? 0,
                        model,
                        {
                          cached_content_token_count: cachedContentTokens,
                        },
                        config.pricingRegistry,
                      ),
                      ...(typeof cachedContentTokens === "number"
                        ? { cacheReadInputTokens: cachedContentTokens }
                        : {}),
                      ...(typeof reasoningTokens === "number" ? { reasoningTokens } : {}),
                    },
                  });
                }
                emit.end();
              } catch (error) {
                // Hotfix 0.5-5: normalize stream errors (parity with complete()).
                emit.fail(toEffectError(error, model));
              }
            })();
          }));
        }),

      completeStructured: (request) =>
        Effect.gen(function* () {
          const jsonSchema = JSONSchema.make(request.outputSchema);
          const schemaObj = deepClone<Record<string, unknown>>(jsonSchema);
          const schemaStr = JSON.stringify(schemaObj, null, 2);

          const client = yield* Effect.promise(() => getClient());
          let model = typeof request.model === 'string'
            ? request.model
            : request.model?.model ?? config.defaultModel;
          if (!model || model.startsWith("claude") || model.startsWith("gpt-")) {
            model = GEMINI_DEFAULT_MODEL;
          }

          const messagesWithFormat: LLMMessage[] = [
            ...request.messages,
            {
              role: "user" as const,
              content: `Respond with JSON matching this schema:\n${schemaStr}`,
            },
          ];

          return yield* runStructuredParseWithRetry({
            outputSchema: request.outputSchema,
            schemaStr,
            maxRetries: request.maxParseRetries ?? 2,
            runAttempt: ({ attempt, lastError }) =>
              Effect.gen(function* () {
                const msgs =
                  attempt === 0
                    ? messagesWithFormat
                    : [
                        ...messagesWithFormat,
                        {
                          role: "assistant" as const,
                          content: String(lastError),
                        },
                        {
                          role: "user" as const,
                          content: `That response did not match the schema. Error: ${String(lastError)}. Please try again.`,
                        },
                      ];

                const wire = toGeminiContents(msgs, geminiContentPolicy(model), signatures.lookup);
                yield* emitContentDegradations("gemini", model, wire.degraded);
                const response = yield* Effect.tryPromise({
                  try: () =>
                    thinkingFallback.run(
                      model,
                      buildGeminiConfig({
                        model,
                        maxTokens: request.maxTokens,
                        temperature: request.temperature,
                        systemPrompt: request.systemPrompt,
                        responseMimeType: "application/json",
                        responseSchema: schemaObj,
                        thinking: request.thinking,
                      }),
                      (cfg) => client.models.generateContent({ model, contents: wire.contents, config: cfg }),
                    ),
                  catch: toEffectError,
                });

                const mapped = mapGeminiResponse(response, model, config.pricingRegistry);
                // No thinkingChars: the request does not set includeThoughts, so
                // Gemini returns no thought text (only a thoughts token count).
                // Raw finishReason (STOP, MAX_TOKENS, ...): the gemini table maps none.
                const stopReason = reportedStopReason(response.candidates?.[0]?.finishReason, "gemini");
                return { content: mapped.content, usage: mapped.usage, ...(stopReason !== undefined ? { stopReason } : {}) };
              }),
          });
        }),

      embed: (texts, model) =>
        Effect.tryPromise({
          try: async () => {
            const client = await getClient();
            const embeddingModel = model ?? "gemini-embedding-001";

            const result = await client.models.embedContent({
              model: embeddingModel,
              contents: [...texts],
              config: {
                outputDimensionality: config.embeddingConfig.dimensions,
              },
            });

            return result.embeddings.map((e) => e.values);
          },
          catch: (error) =>
            new LLMError({
              message: `Embedding failed: ${error}`,
              provider: "gemini",
              cause: error,
            }),
        }),

      countTokens: (messages) =>
        Effect.gen(function* () {
          return yield* estimateTokenCount(messages);
        }),

      getModelConfig: () =>
        Effect.succeed({
          provider: "gemini" as const,
          model: config.defaultModel,
        }),

      getStructuredOutputCapabilities: () =>
        Effect.succeed({
          nativeJsonMode: true,
          jsonSchemaEnforcement: false,
          prefillSupport: false,
          grammarConstraints: false,
        }),

      capabilities: () =>
        Effect.succeed({
          supportsToolCalling: true,
          supportsStreaming: true,
          supportsStructuredOutput: true,
          supportsLogprobs: false,
          inputModalities: GEMINI_INPUT_MODALITIES,
        } satisfies ProviderCapabilities),
    });
  }),
);
