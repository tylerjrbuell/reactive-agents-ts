/**
 * field-requirements — derives required/optional field metadata from an Effect Schema AST.
 *
 * Pure functions; no LLM calls. Used by the grounded engine orchestrator (Task 2.4)
 * to decide which fields must be present before the output can be accepted.
 */
import { Schema, SchemaAST } from "effect";

// ── Public types ────────────────────────────────────────────────────────────

export interface FieldRequirement {
  readonly path: string;
  readonly required: boolean;
}

// ── Implementation ──────────────────────────────────────────────────────────

/**
 * Walk the top-level property signatures of a `Schema.Struct` (Effect Schema AST
 * `TypeLiteral`) and return one `FieldRequirement` per field.
 *
 * Returns `[]` for non-struct schemas (strings, unions, custom declarations, …)
 * so callers can safely apply it to any schema without a prior type guard.
 *
 * AST shape (verified against installed effect version):
 *   - `schema.ast._tag === "TypeLiteral"`
 *   - `ast.propertySignatures: ReadonlyArray<SchemaAST.PropertySignature>`
 *   - `PropertySignature` extends `OptionalType` which carries `isOptional: boolean`
 *   - `PropertySignature.name: PropertyKey`
 */
export function fieldRequirementsFromSchema(
  schema: Schema.Schema.AnyNoContext,
): ReadonlyArray<FieldRequirement> {
  const ast = schema.ast;
  if (ast._tag !== "TypeLiteral") return [];
  return (ast as SchemaAST.TypeLiteral).propertySignatures.map(
    (p: SchemaAST.PropertySignature): FieldRequirement => ({
      path: String(p.name),
      required: !p.isOptional,
    }),
  );
}

/**
 * Derive field requirements from a JSON Schema object.
 *
 * Works for any schema emitter (Zod via zod-to-json-schema, Effect via
 * JSONSchema.make, Zod4/Valibot via StandardJSONSchemaV1) — wherever
 * `contract.toJsonSchema()` returns a real JSON Schema.
 *
 * Reads `properties` (field names) and `required: string[]` to produce the
 * same `FieldRequirement[]` shape that `fieldRequirementsFromSchema` produces
 * from the Effect AST. Prefer this function over the AST walker when a JSON
 * Schema is available, because Standard Schema bridges (Schema.declare) have
 * a non-TypeLiteral AST that causes the AST walker to return `[]`.
 *
 * Returns `[]` when there are no `properties` (e.g. primitive JSON schemas).
 */
export function fieldRequirementsFromJsonSchema(
  jsonSchema: Record<string, unknown>,
): ReadonlyArray<FieldRequirement> {
  const props = jsonSchema["properties"];
  if (!props || typeof props !== "object") return [];
  const required = Array.isArray(jsonSchema["required"])
    ? (jsonSchema["required"] as unknown[]).filter(
        (x): x is string => typeof x === "string",
      )
    : [];
  return Object.keys(props as Record<string, unknown>).map(
    (path): FieldRequirement => ({ path, required: required.includes(path) }),
  );
}

/**
 * Return the paths of required fields that are absent (undefined or null) in
 * a partial object.
 *
 * Treats `null` as missing because JSON parsers sometimes emit `null` for
 * absent fields, and downstream consumers should not accept partial data.
 */
export function missingRequiredFields(
  reqs: ReadonlyArray<FieldRequirement>,
  partial: Record<string, unknown>,
): ReadonlyArray<string> {
  return reqs
    .filter((r) => r.required && (partial[r.path] === undefined || partial[r.path] === null))
    .map((r) => r.path);
}
