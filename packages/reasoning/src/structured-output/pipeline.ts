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
import { stripThinking } from "../strategies/kernel/thinking-utils.js";

export interface StructuredOutputConfig<T> {
  readonly schema: Schema.Schema<T>;
  readonly prompt: string;
  readonly systemPrompt?: string;
  readonly examples?: readonly T[];
  readonly maxRetries?: number;
  readonly temperature?: number;
  readonly maxTokens?: number;
  /** Skip completeStructured() and use prompt engineering only (default: false) */
  readonly forcePromptMode?: boolean;
}

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
  maxTokens: number,
  temp: number,
): Effect.Effect<StructuredOutputResult<T> | null, never> =>
  Effect.gen(function* () {
    const caps = yield* llm.getStructuredOutputCapabilities();
    if (!caps.nativeJsonMode || config.forcePromptMode) return null;

    const result = yield* llm.completeStructured({
      messages: [{ role: "user", content: config.prompt }],
      systemPrompt: config.systemPrompt,
      outputSchema: config.schema,
      maxTokens,
      temperature: temp,
      maxParseRetries: 1,
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

    // Optional EventBus for logModelIO observability
    const ebOpt = yield* Effect.serviceOption(EventBus).pipe(
      Effect.catchAll(() => Effect.succeed(Option.none<EventBus["Type"]>())),
    );
    const eb = ebOpt._tag === "Some" ? ebOpt.value : null;

    // Layer 0: Try provider-native structured output first
    const nativeResult = yield* tryNativeStructuredOutput(llm, config, maxTokens, temp);
    if (nativeResult !== null) {
      if (eb) {
        yield* eb.publish({
          _tag: "ReasoningStepCompleted",
          taskId: "structured-output",
          strategy: "structured-output-native",
          step: 1,
          totalSteps: 1,
          prompt: { system: config.systemPrompt ?? "", user: config.prompt },
          thought: nativeResult.raw,
        }).pipe(Effect.catchAll(() => Effect.void));
      }
      return nativeResult;
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
        }).pipe(Effect.catchAll(() => Effect.void));
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

      // Layer 3: Schema validation
      try {
        const parsed = JSON.parse(jsonText);
        const data = Schema.decodeUnknownSync(config.schema)(parsed);
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
