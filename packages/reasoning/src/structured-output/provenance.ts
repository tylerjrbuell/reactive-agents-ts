/**
 * Structured-output provenance: how one `extractStructuredOutput()` call got
 * its value, or why it did not.
 *
 * Every extraction ends with a {@link StructuredOutputReport}. A success
 * carries it on `StructuredOutputResult.report`; a failure carries it on
 * {@link StructuredOutputExtractionError}. Both are also published as a
 * `StructuredOutputReported` event. Everything in the report is computed from
 * what the pipeline observed (no model judgement), so the same responses always
 * produce the same report. Consumers: Cortex ("how this output was obtained"),
 * per-model structured-output success rates, and calibration learning which
 * models need repair.
 *
 * The report types live in `@reactive-agents/core` (trace, Cortex and the
 * event read them too) and are re-exported here; the error class and the
 * helpers that compute a report stay in reasoning.
 */
import { Data, ParseResult } from "effect";
import type {
  StructuredFieldError,
  StructuredOutputLayer,
  StructuredOutputReport,
} from "@reactive-agents/core";

export type {
  JsonRepairStep,
  NativeOutcome,
  StructuredFieldError,
  StructuredOutputFailureKind,
  StructuredOutputLayer,
  StructuredOutputReport,
} from "@reactive-agents/core";

/**
 * Failure of `extractStructuredOutput()` with its provenance report. The
 * `message` is the pipeline's failure text; narrow on `_tag` to read `report`.
 */
export class StructuredOutputExtractionError extends Data.TaggedError("StructuredOutputExtractionError")<{
  readonly message: string;
  readonly report: StructuredOutputReport;
}> {}

/** RFC 6901 JSON Pointer for a validator path. Symbols render by their description. */
export function toJsonPointer(path: ReadonlyArray<PropertyKey>): string {
  return path
    .map((seg) => "/" + (typeof seg === "symbol" ? String(seg.description ?? "") : String(seg)).replace(/~/g, "~0").replace(/\//g, "~1"))
    .join("");
}

/** Field errors from validator issues that carry a key path (schema contracts, Effect `ArrayFormatter`). */
export function fieldErrorsFromPath(
  issues: ReadonlyArray<{ readonly path: ReadonlyArray<PropertyKey>; readonly message: string }>,
): readonly StructuredFieldError[] {
  return issues.map((i) => ({ path: toJsonPointer(i.path), message: i.message }));
}

/** Every field error of an Effect Schema parse failure (not just the first). */
export function fieldErrorsFromParseError(error: ParseResult.ParseError): readonly StructuredFieldError[] {
  return fieldErrorsFromPath(ParseResult.ArrayFormatter.formatErrorSync(error));
}

const isPlainObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x) && Object.getPrototypeOf(x) === Object.prototype;

/**
 * True when `decoded` differs structurally from `parsed` (the JSON the model
 * produced). Arrays and plain objects compare by content; anything else by
 * value identity, so a decoded class instance or Date counts as changed.
 */
export function valueChanged(parsed: unknown, decoded: unknown): boolean {
  if (Object.is(parsed, decoded)) return false;
  if (Array.isArray(parsed) && Array.isArray(decoded)) {
    return parsed.length !== decoded.length || parsed.some((p, i) => valueChanged(p, decoded[i]));
  }
  if (isPlainObject(parsed) && isPlainObject(decoded)) {
    const keys = Object.keys(parsed);
    if (keys.length !== Object.keys(decoded).length) return true;
    return keys.some((k) => !Object.prototype.hasOwnProperty.call(decoded, k) || valueChanged(parsed[k], decoded[k]));
  }
  return true;
}

/** The layer that names a successful prompt-mode extraction. */
export function promptLayer(promptAttempts: number, repaired: boolean, coerced: boolean): StructuredOutputLayer {
  if (promptAttempts > 1) return "retried";
  if (repaired) return "repaired";
  if (coerced) return "coerced";
  return "prompt";
}
