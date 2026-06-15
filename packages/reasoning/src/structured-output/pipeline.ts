/**
 * Structured Output Pipeline — reliable JSON extraction from any LLM.
 *
 * 5-layer fallback:
 *   Layer 0: Provider-native structured output (completeStructured()) — fastest, most reliable
 *   Layer 1: High-signal prompting (schema as example, few-shot, "JSON only")
 *   Layer 2: JSON extraction & repair (pure functions, no LLM)
 *   Layer 3: Schema validation with Effect-TS coercion
 *   Layer 4: Retry with error feedback
 *
 * When the provider supports native JSON mode (OpenAI, Gemini, Ollama), the pipeline
 * delegates to completeStructured() first for schema-enforced output. If that fails,
 * it falls back to prompt engineering + repair.
 *
 * Observability: When EventBus is available, emits ReasoningStepCompleted events
 * with prompt/response data for logModelIO integration.
 */
import { Effect, Option, Schema } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";
import { EventBus } from "@reactive-agents/core";
import { extractJsonBlock, repairJson } from "./json-repair.js";
import { stripThinking } from "../kernel/utils/stream-parser.js";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import type { SchemaContract } from "./schema-contract.js";

interface StructuredOutputBase<T> {
  readonly prompt: string;
  readonly systemPrompt?: string;
  readonly examples?: readonly T[];
  readonly maxRetries?: number;
  readonly temperature?: number;
  readonly maxTokens?: number;
  /** Skip completeStructured() and use prompt engineering only (default: false) */
  readonly forcePromptMode?: boolean;
  /**
   * Run correlation snapshot forwarded to the provider so the observable-LLM
   * chokepoint can key its LLMExchange + ContextPressure events to the real
   * run instead of the `"llm-direct"` placeholder. Only the `complete()`
   * fallback path carries usage; native `completeStructured()` returns parsed
   * data only, so its context-window cannot be reported (known gap).
   */
  readonly traceContext?: { readonly taskId?: string; readonly iteration?: number };
}

/**
 * Provide exactly one of `schema` or `contract` — passing neither or both is
 * a compile-time error via the discriminated union below.
 */
export type StructuredOutputConfig<T> =
  | (StructuredOutputBase<T> & { readonly schema: Schema.Schema<T>; readonly contract?: never })
  | (StructuredOutputBase<T> & { readonly contract: SchemaContract<T>; readonly schema?: never });

export interface StructuredOutputResult<T> {
  readonly data: T;
  readonly raw: string;
  readonly attempts: number;
  readonly repaired: boolean;
  /** Whether the result came from native provider structured output */
  readonly nativeMode: boolean;
}

/**
 * Try provider-native structured output first (Layer 0).
 * Returns the parsed data if the provider supports it and succeeds.
 */
const tryNativeStructuredOutput = <T>(
  llm: LLMService["Type"],
  config: StructuredOutputConfig<T>,
  effectSchema: Schema.Schema<T>,
  maxTokens: number,
  temp: number,
): Effect.Effect<StructuredOutputResult<T> | null, never> =>
  Effect.gen(function* () {
    const caps = yield* llm.getStructuredOutputCapabilities();
    if (!caps.nativeJsonMode || config.forcePromptMode) return null;

    const result = yield* llm.completeStructured({
      messages: [{ role: "user", content: config.prompt }],
      systemPrompt: config.systemPrompt,
      outputSchema: effectSchema,
      maxTokens,
      temperature: temp,
      maxParseRetries: 1,
      ...(config.traceContext ? { traceContext: config.traceContext } : {}),
    }).pipe(
      Effect.map((data): StructuredOutputResult<T> => ({
        data,
        raw: JSON.stringify(data),
        attempts: 1,
        repaired: false,
        nativeMode: true,
      })),
      // Catch both typed errors (Fail) and defects (Die/sync throws)
      Effect.sandbox,
      Effect.catchAll(() => Effect.succeed(null)),
    );

    return result;
  });

/**
 * Extract typed structured output from an LLM response.
 *
 * Strategy:
 * 1. If the provider supports native JSON mode, try completeStructured() first
 * 2. Fall back to prompt engineering + JSON repair + schema validation + retry
 */
export const extractStructuredOutput = <T>(
  config: StructuredOutputConfig<T>,
): Effect.Effect<StructuredOutputResult<T>, Error, LLMService> =>
  Effect.gen(function* () {
    const llm = yield* LLMService;
    const maxRetries = config.maxRetries ?? 2;
    const temp = config.temperature ?? 0.3;
    const maxTokens = config.maxTokens ?? 4096;

    // Resolve effective Effect Schema (from contract or direct schema field)
    const effectSchema = config.contract ? config.contract.effectSchema : config.schema;
    if (!effectSchema) {
      return yield* Effect.fail(new Error("extractStructuredOutput: provide `schema` or `contract`"));
    }

    // Final-layer validation: contract path uses contract.validate(); schema path uses Effect decode
    const validateFinal = (parsed: unknown): T => {
      if (config.contract) {
        const r = config.contract.validate(parsed);
        if (r.ok) return r.value;
        throw new Error(r.issues.map((i) => i.message).join("; "));
      }
      return Schema.decodeUnknownSync(effectSchema)(parsed);
    };

    // Optional EventBus for logModelIO observability
    const ebOpt = yield* Effect.serviceOption(EventBus).pipe(
      Effect.catchAll(() => Effect.succeed(Option.none<EventBus["Type"]>())),
    );
    const eb = ebOpt._tag === "Some" ? ebOpt.value : null;

    // Layer 0: Try provider-native structured output first
    const nativeResult = yield* tryNativeStructuredOutput(llm, config, effectSchema, maxTokens, temp);
    if (nativeResult !== null) {
      // Fix 1: when a contract is set, re-validate the native result against it.
      // completeStructured() uses an Effect-Schema structural predicate that is
      // weaker than the full contract.validate() path (Standard-Schema / Zod /
      // Valibot contracts carry richer coercion and refinement rules).
      // If contract validation fails, discard the native result and fall through
      // to the prompt+repair loop so the user gets full repair semantics.
      if (config.contract) {
        const r = config.contract.validate(nativeResult.data);
        if (!r.ok) {
          // Native result failed contract validation — fall through to prompt path
        } else {
          const validated: StructuredOutputResult<T> = { ...nativeResult, data: r.value };
          if (eb) {
            yield* eb.publish({
              _tag: "ReasoningStepCompleted",
              taskId: "structured-output",
              strategy: "structured-output-native",
              step: 1,
              totalSteps: 1,
              prompt: { system: config.systemPrompt ?? "", user: config.prompt },
              thought: validated.raw,
            }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "reasoning/src/structured-output/pipeline.ts:native-contract", tag: errorTag(err) })));
          }
          return validated;
        }
      } else {
        if (eb) {
          yield* eb.publish({
            _tag: "ReasoningStepCompleted",
            taskId: "structured-output",
            strategy: "structured-output-native",
            step: 1,
            totalSteps: 1,
            prompt: { system: config.systemPrompt ?? "", user: config.prompt },
            thought: nativeResult.raw,
          }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "reasoning/src/structured-output/pipeline.ts:116", tag: errorTag(err) })));
        }
        return nativeResult;
      }
    }

    // Fallback: prompt engineering + repair pipeline
    let lastError: string | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      // Build prompt
      const prompt = attempt === 0
        ? buildStructuredPrompt(config)
        : buildRetryPrompt(config, lastError ?? "Unknown error");

      const systemPrompt = config.systemPrompt
        ? `${config.systemPrompt}\n\nRespond with ONLY valid JSON. No markdown, no explanation, no thinking tags.`
        : "Respond with ONLY valid JSON. No markdown, no explanation, no thinking tags.";

      // Layer 1: LLM call
      const response = yield* llm.complete({
        messages: [{ role: "user", content: prompt }],
        systemPrompt,
        maxTokens,
        temperature: attempt === 0 ? temp : 0.1,
        ...(config.traceContext ? { traceContext: config.traceContext } : {}),
      }).pipe(
        Effect.mapError((e) => new Error(`LLM call failed: ${e instanceof Error ? e.message : String(e)}`)),
      );

      // Emit model IO event for logModelIO observability
      if (eb) {
        yield* eb.publish({
          _tag: "ReasoningStepCompleted",
          taskId: "structured-output",
          strategy: "structured-output",
          step: attempt + 1,
          totalSteps: maxRetries + 1,
          prompt: { system: systemPrompt, user: prompt },
          thought: response.content,
        }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "reasoning/src/structured-output/pipeline.ts:154", tag: errorTag(err) })));
      }

      // Strip <think>...</think> blocks before JSON extraction (thinking models)
      const raw = stripThinking(response.content);
      let repaired = false;

      // Layer 2: Extract and repair JSON
      let jsonText = raw.trim();
      try {
        JSON.parse(jsonText);
      } catch {
        const extracted = extractJsonBlock(jsonText);
        if (extracted) {
          jsonText = extracted;
          repaired = true;
        }
        try {
          JSON.parse(jsonText);
        } catch {
          jsonText = repairJson(jsonText);
          repaired = true;
        }
      }

      // Layer 3: Schema validation (via contract or direct Effect Schema)
      try {
        const parsed = JSON.parse(jsonText);
        const data = validateFinal(parsed);
        return { data, raw, attempts: attempt + 1, repaired, nativeMode: false };
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        if (attempt === maxRetries) {
          return yield* Effect.fail(
            new Error(`Structured output failed after ${attempt + 1} attempts. Last error: ${lastError}`),
          );
        }
        // Layer 4: Continue to retry loop
      }
    }

    // Unreachable but TypeScript needs it
    return yield* Effect.fail(new Error("Structured output exhausted all retries"));
  });

// ── Prompt builders ──

function buildStructuredPrompt<T>(config: StructuredOutputConfig<T>): string {
  const parts: string[] = [config.prompt];

  if (config.examples && config.examples.length > 0) {
    parts.push("\nExample output:");
    for (const ex of config.examples) {
      parts.push(JSON.stringify(ex, null, 2));
    }
  }

  parts.push("\nRespond with ONLY a JSON object matching the schema above. No markdown fences, no explanation.");
  return parts.join("\n");
}

function buildRetryPrompt<T>(config: StructuredOutputConfig<T>, error: string): string {
  return `Your previous response was not valid JSON. Error: ${error}

Original request: ${config.prompt}

Please respond with ONLY a valid JSON object. No markdown, no explanation.`;
}
