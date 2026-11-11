/**
 * Structured-output provenance: how one `extractStructuredOutput()` call got
 * its value, or why it did not.
 *
 * Every extraction ends with a {@link StructuredOutputReport}. A success
 * carries it on `StructuredOutputResult.report`; a failure carries it on
 * {@link StructuredOutputExtractionError}. Everything in the report is
 * computed from what the pipeline observed (no model judgement), so the same
 * responses always produce the same report. Consumers: Cortex ("how this
 * output was obtained"), per-model structured-output success rates, and
 * calibration learning which models need repair.
 */
import { Data, ParseResult } from "effect";

/**
 * The layer that produced the value, named by the furthest fallback the
 * extraction needed (precedence: native, then retried, repaired, coerced,
 * prompt). Flags such as `repairs` and `coerced` stay set on the report even
 * when a later layer names the outcome.
 *
 * - `native`: the provider's schema-constrained call (`completeStructured`).
 * - `prompt`: prompt-mode JSON that validated as returned.
 * - `repaired`: prompt-mode JSON that validated only after extraction/repair.
 * - `coerced`: the validator returned a value that differs from the parsed
 *   JSON (type coercion, defaults, transforms, stripped keys).
 * - `retried`: a prompt-mode retry with error feedback produced the value.
 */
export type StructuredOutputLayer = "native" | "prompt" | "repaired" | "coerced" | "retried";

/** One deterministic text repair applied to model output before parsing. */
export type JsonRepairStep =
  | "extract-json-block"
  | "strip-comments"
  | "single-quotes"
  | "python-literals"
  | "non-finite"
  | "unescaped-newlines"
  | "trailing-commas"
  | "close-unclosed";

/** What happened to the provider-native attempt (Layer 0). */
export type NativeOutcome = "not-attempted" | "succeeded" | "failed" | "contract-rejected";

/** One validation failure at a field. `path` is an RFC 6901 JSON Pointer (`""` = the root value). */
export interface StructuredFieldError {
  readonly path: string;
  readonly message: string;
}

/** Why a failed extraction failed. */
export type StructuredOutputFailureKind =
  /** The last response held no parseable JSON, even after repair. */
  | "invalid-json"
  /** JSON parsed but did not match the schema (see `fieldErrors`). */
  | "schema-mismatch"
  /** The response was empty twice: the output budget ran out before any JSON. */
  | "empty-output"
  /** The LLM call itself failed. */
  | "llm-error";

/** How one structured-output extraction succeeded or failed. */
export interface StructuredOutputReport {
  readonly outcome: "success" | "failure";
  /** The layer that produced the value; `null` on failure. */
  readonly layer: StructuredOutputLayer | null;
  readonly native: NativeOutcome;
  /** Model requests made: native attempts plus prompt-mode attempts. */
  readonly attempts: number;
  /** Prompt-mode requests made (0 when the native layer answered). */
  readonly promptAttempts: number;
  /** Repairs applied to the deciding response (the winner, or the last failure), in order. */
  readonly repairs: readonly JsonRepairStep[];
  /** True when the validator transformed the parsed value. */
  readonly coerced: boolean;
  /** True when an empty response made the pipeline double its output budget. */
  readonly budgetEscalated: boolean;
  /** Field-level errors of the last failed validation; empty on success. */
  readonly fieldErrors: readonly StructuredFieldError[];
  /** Set on failure only. */
  readonly failure?: { readonly kind: StructuredOutputFailureKind; readonly message: string };
}

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
