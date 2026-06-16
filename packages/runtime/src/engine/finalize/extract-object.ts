/**
 * Fast-path structured output extraction helper.
 *
 * Wraps `extractStructuredOutput` from @reactive-agents/reasoning with
 * the runtime's degrade/throw bifurcation so callers don't have to handle
 * Effect errors inline.
 *
 * Used by the agent finalization path when `.withOutputSchema()` is configured.
 * Mode routing (fast / grounded / auto) is added in Task 1.5; this module
 * always uses the fast path (single extraction call).
 */
import { Effect } from "effect";
import { extractStructuredOutput } from "@reactive-agents/reasoning";
import type { SchemaContract } from "@reactive-agents/reasoning";
import { LLMService } from "@reactive-agents/llm-provider";
import { StructuredOutputError } from "../../errors/structured-output-error.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ExtractObjectInput<A> {
  readonly contract: SchemaContract<A>;
  readonly finalAnswer: string;
  readonly onParseFail: "degrade" | "throw";
  readonly traceContext?: { readonly taskId?: string; readonly iteration?: number };
}

export interface ExtractObjectOutput<A> {
  readonly object?: A;
  readonly objectError?: string;
}

// ─── Implementation ───────────────────────────────────────────────────────────

/**
 * Extract typed structured output from a final answer string.
 *
 * On success: returns `{ object: <parsed value> }`.
 * On failure with `onParseFail: "degrade"`: returns `{ objectError: <message> }`.
 * On failure with `onParseFail: "throw"`: fails with `StructuredOutputError`.
 *
 * Requires `LLMService` in the Effect environment (provided by the ManagedRuntime).
 */
export const extractObjectFromAnswer = <A>(
  input: ExtractObjectInput<A>,
): Effect.Effect<ExtractObjectOutput<A>, StructuredOutputError, LLMService> =>
  extractStructuredOutput<A>({
    contract: input.contract,
    prompt: `Extract the structured data described by the schema from the following result.\n\n${input.finalAnswer}`,
    ...(input.traceContext ? { traceContext: input.traceContext } : {}),
  }).pipe(
    Effect.map((r): ExtractObjectOutput<A> => ({ object: r.data })),
    Effect.catchAll((e) =>
      input.onParseFail === "throw"
        ? Effect.fail(
            new StructuredOutputError({
              rawText: input.finalAnswer,
              issues: [e instanceof Error ? e.message : String(e)],
            }),
          )
        : Effect.succeed<ExtractObjectOutput<A>>({
            objectError: e instanceof Error ? e.message : String(e),
          }),
    ),
  );
