/**
 * Fast-path structured output extraction helper.
 *
 * Wraps `extractStructuredOutput` from @reactive-agents/reasoning with
 * the runtime's degrade/throw bifurcation so callers don't have to handle
 * Effect errors inline.
 *
 * Used by the agent finalization path when `.withOutputSchema()` is configured,
 * and by `runStream(task, { outputSchema })` (agent/turn-schema.ts).
 * Every extraction's provenance report is kept: on the output as
 * `objectReport` (success and degrade), on `StructuredOutputError.report`
 * (throw).
 */
import { Effect } from "effect";
import { extractStructuredOutput, parsePartial, stripThinking } from "@reactive-agents/reasoning";
import type { SchemaContract } from "@reactive-agents/reasoning";
import type { StructuredOutputReport } from "@reactive-agents/core";
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
  /** How the extraction pipeline got `object` or why it failed. Absent only when the pipeline did not report. */
  readonly objectReport?: StructuredOutputReport;
}

/** The report a pipeline failure carries (`StructuredOutputExtractionError`), if any. */
const reportOf = (e: unknown): StructuredOutputReport | undefined =>
  typeof e === "object" && e !== null && (e as { _tag?: unknown })._tag === "StructuredOutputExtractionError"
    ? (e as { report?: StructuredOutputReport }).report
    : undefined;

// ─── Implementation ───────────────────────────────────────────────────────────

/**
 * Loosely parse the first complete JSON value (object `{…}` or array `[…]`)
 * from `text` after stripping thinking tags, markdown fences, and leading prose.
 *
 * Returns the parsed value (object or array) on success, or `null` if no
 * top-level JSON structure can be found or parsed.
 *
 * (Moved verbatim from `agent/run-task-effect.ts`; shared with the per-turn
 * stream schema.)
 */
export const parseJsonLoose = (text: string): unknown => {
    const cleaned = stripThinking(text).trim()
    // Strip markdown code fences: ```json … ``` or ``` … ```
    const defenced = cleaned
        .replace(/^```(?:json)?\s*\n?/i, "")
        .replace(/\n?```\s*$/, "")
        .trim()

    // Try to find first `{` (object) or `[` (array) and parse from there.
    const braceIdx = defenced.indexOf("{")
    const bracketIdx = defenced.indexOf("[")
    // Pick the earlier of the two (or whichever is present)
    let startIdx: number
    if (braceIdx === -1 && bracketIdx === -1) return null
    if (braceIdx === -1) startIdx = bracketIdx
    else if (bracketIdx === -1) startIdx = braceIdx
    else startIdx = Math.min(braceIdx, bracketIdx)

    const candidate = defenced.slice(startIdx)
    try {
        return JSON.parse(candidate)
    } catch {
        // Try parsePartial for objects — handles truncated/fenced input
        if (candidate.startsWith("{")) {
            const partial = parsePartial(candidate)
            // parsePartial returns {} on failure; treat empty as failure
            if (Object.keys(partial).length > 0) return partial
        }
        return null
    }
}

/**
 * Extract typed structured output from a final answer string.
 *
 * On success: returns `{ object, objectReport }`.
 * On failure with `onParseFail: "degrade"`: returns `{ objectError, objectReport }`.
 * On failure with `onParseFail: "throw"`: fails with `StructuredOutputError` (its `report` set).
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
    Effect.map((r): ExtractObjectOutput<A> => ({ object: r.data, objectReport: r.report })),
    Effect.catchAll((e) => {
      const report = reportOf(e);
      return input.onParseFail === "throw"
        ? Effect.fail(
            new StructuredOutputError({
              rawText: input.finalAnswer,
              issues: [e instanceof Error ? e.message : String(e)],
              ...(report !== undefined ? { report } : {}),
            }),
          )
        : Effect.succeed<ExtractObjectOutput<A>>({
            objectError: e instanceof Error ? e.message : String(e),
            ...(report !== undefined ? { objectReport: report } : {}),
          });
    }),
  );

/**
 * The fast structured-output path for one answer: parse-first (the answer
 * itself validates against the schema, no LLM call, no report), else the
 * extraction pipeline in `degrade` mode. Never fails.
 */
export const deriveObjectFromAnswer = <A>(input: {
  readonly contract: SchemaContract<A>;
  readonly finalAnswer: string;
  readonly taskId?: string;
}): Effect.Effect<ExtractObjectOutput<A>, never, LLMService> => {
  const parsed = parseJsonLoose(input.finalAnswer);
  const direct = parsed !== null ? input.contract.validate(parsed) : null;
  if (direct?.ok === true) return Effect.succeed({ object: direct.value });
  return extractObjectFromAnswer({
    contract: input.contract,
    finalAnswer: input.finalAnswer,
    onParseFail: "degrade",
    ...(input.taskId !== undefined ? { traceContext: { taskId: input.taskId } } : {}),
  }).pipe(Effect.catchAll((e) => Effect.succeed<ExtractObjectOutput<A>>({ objectError: e.message })));
};
