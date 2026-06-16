/**
 * json-schema-output.ts — bridge a raw JSON Schema (authored in the Cortex UI)
 * into the framework's structured-output contract.
 *
 * `.withOutputSchema()` takes a Standard Schema / Effect Schema, but the desk
 * only has a JSON Schema object. We wrap it as a minimal Standard Schema v1:
 *   - the `~standard.jsonSchema.output` extension hands the framework the exact
 *     JSON Schema for prompt steering + extraction (see schema-contract.ts
 *     `fromStandardSchema.toJsonSchema`), and
 *   - `validate` is LENIENT (accepts any object), matching the framework's
 *     lenient-degrade default — `result.object` is the extracted object, and
 *     malformed extractions surface as `result.objectError` rather than throwing.
 *
 * No JSON-Schema → Effect-Schema conversion is needed: the contract's
 * `effectSchema` is built from `validate` via `Schema.declare`.
 */
import type { StandardSchemaV1 } from "@standard-schema/spec";

/** True for a non-null, non-array object. */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Wrap a JSON Schema as a lenient Standard Schema for `.withOutputSchema()`.
 * Top-level `type: "array"` accepts arrays; anything else accepts objects.
 */
export function jsonSchemaToStandardSchema(
  jsonSchema: Record<string, unknown>,
): StandardSchemaV1<unknown, unknown> {
  const wantsArray = jsonSchema["type"] === "array";
  const std = {
    version: 1 as const,
    vendor: "cortex-json-schema",
    validate: (value: unknown): StandardSchemaV1.Result<unknown> => {
      if (wantsArray ? Array.isArray(value) : isPlainObject(value)) {
        return { value };
      }
      return { issues: [{ message: wantsArray ? "expected an array" : "expected an object" }] };
    },
    // StandardJSONSchemaV1 extension — read by schema-contract.ts to steer the
    // extraction prompt with the exact shape the user authored.
    jsonSchema: { output: () => jsonSchema },
  };
  return { "~standard": std } as unknown as StandardSchemaV1<unknown, unknown>;
}
