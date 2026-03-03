/**
 * Structured Output Pipeline — reliable JSON extraction from any LLM.
 *
 * 4-layer fallback:
 *   Layer 1: High-signal prompting (schema as example, few-shot, "JSON only")
 *   Layer 2: JSON extraction & repair (pure functions, no LLM)
 *   Layer 3: Schema validation with Effect-TS coercion
 *   Layer 4: Retry with error feedback
 */
import { Effect, Schema } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";
import { extractJsonBlock, repairJson } from "./json-repair.js";

export interface StructuredOutputConfig<T> {
  readonly schema: Schema.Schema<T>;
  readonly prompt: string;
  readonly systemPrompt?: string;
  readonly examples?: readonly T[];
  readonly maxRetries?: number;
  readonly temperature?: number;
  readonly maxTokens?: number;
}

export interface StructuredOutputResult<T> {
  readonly data: T;
  readonly raw: string;
  readonly attempts: number;
  readonly repaired: boolean;
}

/**
 * Extract typed structured output from an LLM response.
 * Attempts parsing, repair, validation, and retry with error feedback.
 */
export const extractStructuredOutput = <T>(
  config: StructuredOutputConfig<T>,
): Effect.Effect<StructuredOutputResult<T>, Error, LLMService> =>
  Effect.gen(function* () {
    const llm = yield* LLMService;
    const maxRetries = config.maxRetries ?? 2;
    const temp = config.temperature ?? 0.3;
    const maxTokens = config.maxTokens ?? 2000;

    let lastError: string | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      // Build prompt
      const prompt = attempt === 0
        ? buildStructuredPrompt(config)
        : buildRetryPrompt(config, lastError ?? "Unknown error");

      const systemPrompt = config.systemPrompt
        ? `${config.systemPrompt}\n\nRespond with ONLY valid JSON. No markdown, no explanation.`
        : "Respond with ONLY valid JSON. No markdown, no explanation.";

      // Layer 1: LLM call
      const response = yield* llm.complete({
        messages: [{ role: "user", content: prompt }],
        systemPrompt,
        maxTokens,
        temperature: attempt === 0 ? temp : 0.1,
      }).pipe(
        Effect.mapError((e) => new Error(`LLM call failed: ${String(e)}`)),
      );

      const raw = response.content;
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
        return { data, raw, attempts: attempt + 1, repaired };
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
