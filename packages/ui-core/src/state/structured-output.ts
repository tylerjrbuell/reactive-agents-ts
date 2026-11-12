import type { StructuredOutputReportWire, UiStreamEvent } from "../protocol/events.js";

/**
 * Structured-output view models: the typed `object` an agent with an output
 * schema returns, shown as a field table, and the framework's provenance
 * report ("how output was obtained") in plain words. Pure and dependency-free,
 * shared by Cortex and any builder's own UI.
 */

/** What a turn or run with an output schema produced. */
export interface TurnStructured {
  /** The schema-valid value; absent when none was produced. */
  readonly object?: unknown;
  /** Why no schema-valid value was produced. */
  readonly error?: string;
  /** How the extraction pipeline got the value, or why it failed. */
  readonly report?: StructuredOutputReportWire;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Fold one stream event into the structured output. `StructuredOutputReported`
 * sets the report (the latest wins); `StreamCompleted` carries `object`,
 * `objectError` and `objectReport`. Any other event returns `s` unchanged (the
 * same reference), so callers can skip a patch.
 */
export function foldStructured(s: TurnStructured | undefined, event: UiStreamEvent): TurnStructured | undefined {
  if (event._tag === "StructuredOutputReported") return { ...s, report: event.report };
  if (event._tag === "StreamCompleted") {
    if (event.object === undefined && event.objectError === undefined && event.objectReport === undefined) return s;
    return {
      ...s,
      ...(event.object !== undefined ? { object: event.object } : {}),
      ...(event.objectError !== undefined ? { error: event.objectError } : {}),
      ...(event.objectReport !== undefined ? { report: event.objectReport } : {}),
    };
  }
  return s;
}

/** The kind of value in a field row. */
export type FieldKind = "string" | "number" | "boolean" | "null" | "array" | "object";

/** One row of the field table. */
export interface FieldRow {
  /** RFC 6901 JSON Pointer of the value inside the object (`/address/city`). */
  readonly pointer: string;
  /** The field's name (an array item reads `[0]`). */
  readonly label: string;
  /** Nesting depth, 0 at the top level. */
  readonly depth: number;
  readonly kind: FieldKind;
  /** The value as text; empty for an object (its fields follow as rows). */
  readonly display: string;
  /** The schema's description of the field, when it has one. */
  readonly description?: string;
  /** The validator's message when this field failed. */
  readonly error?: string;
}

/** Most rows a table holds, so a huge object cannot freeze the page. */
export const MAX_FIELD_ROWS = 200;
const MAX_DEPTH = 4;

const kindOf = (v: unknown): FieldKind =>
  v === null ? "null" : Array.isArray(v) ? "array" : isRecord(v) ? "object" : typeof v === "number" ? "number" : typeof v === "boolean" ? "boolean" : "string";

const escapePointer = (key: string): string => key.replace(/~/g, "~0").replace(/\//g, "~1");

/** A JSON Pointer as a dotted field path for people (`/a/b~1c` reads `a.b/c`; `""` reads `the whole answer`). */
export function pointerLabel(pointer: string): string {
  if (pointer === "") return "the whole answer";
  return pointer
    .split("/")
    .slice(1)
    .map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"))
    .join(".");
}

const scalarText = (v: unknown): string => (typeof v === "string" ? v : v === null ? "null" : String(v));

/**
 * The field table for a value: one row per field, objects expanded in place
 * (to four levels), key order following the schema's `properties` first. A
 * schema's `description` rides each row it describes; `errors` (the report's
 * `fieldErrors`) mark the rows that failed.
 */
export function fieldRowsOf(
  value: unknown,
  schema?: unknown,
  errors: readonly { readonly path: string; readonly message: string }[] = [],
): readonly FieldRow[] {
  const errorAt = new Map(errors.map((e) => [e.path, e.message] as const));
  const rows: FieldRow[] = [];
  const walk = (v: unknown, node: unknown, pointer: string, label: string, depth: number): void => {
    if (rows.length >= MAX_FIELD_ROWS) return;
    const kind = kindOf(v);
    const desc = isRecord(node) && typeof node.description === "string" && node.description.trim() !== "" ? node.description : undefined;
    const error = errorAt.get(pointer);
    const scalarArray = Array.isArray(v) && v.every((x) => kindOf(x) !== "object" && kindOf(x) !== "array");
    const display = kind === "object" ? "" : kind === "array" ? (scalarArray ? (v as unknown[]).map(scalarText).join(", ") : `${(v as unknown[]).length} items`) : scalarText(v);
    rows.push({ pointer, label, depth, kind, display, ...(desc !== undefined ? { description: desc } : {}), ...(error !== undefined ? { error } : {}) });
    if (depth >= MAX_DEPTH) return;
    if (kind === "object") {
      const obj = v as Record<string, unknown>;
      const props = isRecord(node) && isRecord(node.properties) ? node.properties : {};
      const keys = [...Object.keys(props).filter((k) => k in obj), ...Object.keys(obj).filter((k) => !(k in props))];
      for (const k of keys) walk(obj[k], props[k], `${pointer}/${escapePointer(k)}`, k, depth + 1);
    } else if (kind === "array" && !scalarArray) {
      const items = isRecord(node) ? node.items : undefined;
      (v as unknown[]).forEach((item, i) => walk(item, items, `${pointer}/${i}`, `[${i}]`, depth + 1));
    }
  };
  if (isRecord(value)) {
    const props = isRecord(schema) && isRecord(schema.properties) ? schema.properties : {};
    const keys = [...Object.keys(props).filter((k) => k in value), ...Object.keys(value).filter((k) => !(k in props))];
    for (const k of keys) walk(value[k], props[k], `/${escapePointer(k)}`, k, 0);
  } else if (Array.isArray(value)) {
    value.forEach((item, i) => walk(item, isRecord(schema) ? schema.items : undefined, `/${i}`, `[${i}]`, 0));
  } else if (value !== undefined) {
    walk(value, schema, "", "value", 0);
  }
  return rows;
}

/** True when `value` has something to tabulate (a non-empty object or array, or a scalar). */
export const hasFieldRows = (value: unknown): boolean => isRecord(value) ? Object.keys(value).length > 0 : Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null;

/** How the output was obtained, in plain words. */
export interface ObtainedView {
  /** `ok` = produced as asked; `attention` = produced, but only after repair, coercion or a retry; `bad` = no schema-valid value. */
  readonly tone: "ok" | "attention" | "bad";
  /** One line: what happened. */
  readonly headline: string;
  /** The layer that produced the value, in words; absent on failure. */
  readonly layer?: string;
  /** Label/value facts: the native attempt, the model requests, budget and coercion. */
  readonly facts: readonly { readonly label: string; readonly value: string }[];
  /** Repairs applied to the model's text before it parsed, in order, in words. */
  readonly repairs: readonly string[];
  /** Failed fields: the JSON Pointer, a readable path and the validator's message. */
  readonly fieldErrors: readonly { readonly pointer: string; readonly field: string; readonly message: string }[];
  /** Why extraction failed, when it did. */
  readonly failure?: { readonly kind: string; readonly message: string };
}

const LAYER_WORDS: Readonly<Record<string, string>> = {
  native: "The provider's schema-constrained call returned it.",
  prompt: "The model answered in JSON that validated as returned.",
  repaired: "The model's JSON validated only after it was extracted or repaired.",
  coerced: "The validator adjusted the value (types, defaults or stripped keys).",
  retried: "A retry with error feedback produced it.",
};

const NATIVE_WORDS: Readonly<Record<string, string>> = {
  "not-attempted": "not attempted",
  succeeded: "succeeded",
  failed: "failed, fell back to prompt mode",
  "contract-rejected": "the provider rejected the schema, fell back to prompt mode",
};

const REPAIR_WORDS: Readonly<Record<string, string>> = {
  "extract-json-block": "Pulled the JSON out of surrounding text",
  "strip-comments": "Removed comments",
  "single-quotes": "Changed single quotes to double quotes",
  "python-literals": "Changed Python literals (True, False, None) to JSON",
  "non-finite": "Replaced NaN and Infinity",
  "unescaped-newlines": "Escaped raw newlines inside strings",
  "trailing-commas": "Removed trailing commas",
  "close-unclosed": "Closed brackets the model left open",
};

const FAILURE_WORDS: Readonly<Record<string, string>> = {
  "invalid-json": "The reply held no parseable JSON, even after repair.",
  "schema-mismatch": "The JSON parsed but did not match the schema.",
  "empty-output": "The reply was empty twice: the output budget ran out before any JSON.",
  "llm-error": "The model call itself failed.",
};

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/**
 * Describe a structured-output report for people. `objectError` (the result's
 * own error text) is used when the run has no report, e.g. the answer failed
 * before the pipeline ran.
 */
export function obtainedOf(report: StructuredOutputReportWire | undefined, objectError?: string): ObtainedView {
  if (report === undefined) {
    return objectError !== undefined
      ? { tone: "bad", headline: "No schema-valid value was produced.", facts: [], repairs: [], fieldErrors: [], failure: { kind: "error", message: objectError } }
      : { tone: "ok", headline: "The answer matched the schema as written; no extraction call was needed.", facts: [], repairs: [], fieldErrors: [] };
  }
  const facts: { label: string; value: string }[] = [
    { label: "Provider-native call", value: NATIVE_WORDS[report.native] ?? report.native },
    {
      label: "Model requests",
      value: report.promptAttempts > 0 ? `${report.attempts} (${plural(report.promptAttempts, "in prompt mode", "in prompt mode")})` : String(report.attempts),
    },
  ];
  if (report.budgetEscalated) facts.push({ label: "Output budget", value: "doubled after an empty reply" });
  if (report.coerced) facts.push({ label: "Coerced", value: "the validator changed the parsed value" });
  const repairs = report.repairs.map((r) => REPAIR_WORDS[r] ?? r);
  const fieldErrors = report.fieldErrors.map((e) => ({ pointer: e.path, field: pointerLabel(e.path), message: e.message }));
  if (report.outcome === "failure") {
    const kind = report.failure?.kind ?? "error";
    return {
      tone: "bad",
      headline: "No schema-valid value was produced.",
      facts,
      repairs,
      fieldErrors,
      failure: { kind: FAILURE_WORDS[kind] ?? kind, message: report.failure?.message ?? objectError ?? "" },
    };
  }
  const layer = report.layer ?? "prompt";
  return {
    tone: layer === "native" || layer === "prompt" ? "ok" : "attention",
    headline: plural(report.attempts, "model request", "model requests") + (layer === "native" || layer === "prompt" ? ", no help needed." : ", needed help to validate."),
    layer: LAYER_WORDS[layer] ?? layer,
    facts,
    repairs,
    fieldErrors,
  };
}
