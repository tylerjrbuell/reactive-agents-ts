/**
 * Per-turn structured output for `runStream(task, { outputSchema })`.
 *
 * One turn (for example one chat message) can ask for a typed answer without
 * changing the agent: the turn's input is steered to answer as JSON (same
 * steering `.withOutputSchema()` uses), and when the run completes the answer
 * goes through the fast structured-output path (parse-first, then the
 * extraction pipeline in `degrade` mode). The result rides the terminal
 * `StreamCompleted` as `object` / `objectError` / `objectReport`, so
 * `AgentStream.collect()` gives the same fields `run()` does.
 *
 * `runStream()` never throws: a schema the runtime cannot validate ends the
 * stream with one `StreamError` before anything runs.
 */
import type { ManagedRuntime } from "effect";
import type { SchemaContract } from "@reactive-agents/reasoning";
import type { AgentStreamEvent } from "../stream-types.js";
import { toOutputSchemaContract, type AnyOutputSchema } from "../engine/finalize/json-schema-contract.js";
import { deriveObjectFromAnswer } from "../engine/finalize/extract-object.js";
import { buildSchemaSteering } from "./schema-steering.js";

/** Options-bag mixin: a structured-output schema for one `runStream()` turn. */
export interface OutputSchemaRunOption {
  /**
   * Schema for this turn only: an Effect Schema, a Standard Schema, or a JSON
   * Schema object (same forms as `.withOutputSchema()`). The turn is steered
   * to answer as JSON, and `StreamCompleted` carries `object` (schema-valid
   * value), or `objectError`, plus `objectReport` whenever the extraction
   * pipeline ran. Lenient: a failed extraction never fails the stream. The
   * agent's own `.withOutputSchema()` is not used by `runStream()`.
   */
  readonly outputSchema?: AnyOutputSchema;
}

/**
 * Run one streamed turn with an optional per-turn schema.
 *
 * @param schema - The turn's `outputSchema`, or `undefined` for a plain turn.
 * @param input - The turn's input before steering.
 * @param runtime - The agent's runtime (provides `LLMService` for extraction).
 * @param start - Starts the run with the (possibly steered) input.
 * @returns The run's events; `StreamCompleted` carries the object fields when a schema was given.
 */
export async function* runTurnWithSchema(
  schema: AnyOutputSchema | undefined,
  input: string,
  runtime: ManagedRuntime.ManagedRuntime<unknown, never>,
  start: (input: string) => AsyncGenerator<AgentStreamEvent>,
): AsyncGenerator<AgentStreamEvent> {
  if (schema === undefined) {
    yield* start(input);
    return;
  }
  let contract: SchemaContract<unknown>;
  try {
    contract = toOutputSchemaContract(schema);
  } catch (e) {
    yield { _tag: "StreamError", cause: String((e as { message?: unknown }).message ?? e) };
    return;
  }
  for await (const event of start(`${input}${buildSchemaSteering(contract)}`)) {
    // A paused or failed run has no final answer to type.
    if (event._tag !== "StreamCompleted" || event.status !== undefined || event.success === false) {
      yield event;
      continue;
    }
    // deriveObjectFromAnswer never fails; a defect (no LLM service) still must not throw out of runStream().
    const derived = await runtime
      .runPromise(deriveObjectFromAnswer({ contract, finalAnswer: event.output, ...(event.taskId ? { taskId: event.taskId } : {}) }))
      .catch((e: unknown) => ({ objectError: String((e as { message?: unknown }).message ?? e), object: undefined, objectReport: undefined }));
    yield {
      ...event,
      ...(derived.object !== undefined ? { object: derived.object } : {}),
      ...(derived.objectError !== undefined ? { objectError: derived.objectError } : {}),
      ...(derived.objectReport !== undefined ? { objectReport: derived.objectReport } : {}),
    };
  }
}
