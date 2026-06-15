import { Schema, JSONSchema, ParseResult, Either } from "effect";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { zodToJsonSchema } from "zod-to-json-schema";

// ── Public types ────────────────────────────────────────────────────────────

export interface SchemaIssue {
  readonly path: ReadonlyArray<PropertyKey>;
  readonly message: string;
}

export type SchemaValidationResult<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly issues: ReadonlyArray<SchemaIssue> };

export interface SchemaContract<A> {
  readonly validate: (v: unknown) => SchemaValidationResult<A>;
  readonly toJsonSchema: () => Record<string, unknown> | undefined;
  readonly effectSchema: Schema.Schema<A>;
  readonly label?: string;
}

// ── Discriminators ─────────────────────────────────────────────────────────

/**
 * Detect an Effect Schema by the presence of the `ast` property.
 * Standard Schema validators carry `"~standard"` instead.
 *
 * Effect Schema classes are functions (class constructors), so we must
 * accept typeof "function" in addition to "object".
 */
function isEffectSchema<A>(
  input: StandardSchemaV1<unknown, A> | Schema.Schema<A>,
): input is Schema.Schema<A> {
  if (input === null || input === undefined) return false;
  const t = typeof input;
  if (t !== "object" && t !== "function") return false;
  return "ast" in (input as object) && !("~standard" in (input as object));
}

// ── Effect Schema path ──────────────────────────────────────────────────────

function fromEffectSchema<A>(schema: Schema.Schema<A, A, never>): SchemaContract<A> {
  const decode = Schema.decodeUnknownEither(schema);

  return {
    effectSchema: schema,
    validate(v: unknown): SchemaValidationResult<A> {
      const result = decode(v);
      if (Either.isRight(result)) {
        return { ok: true, value: result.right };
      }
      const formatted = ParseResult.ArrayFormatter.formatErrorSync(result.left);
      const issues: ReadonlyArray<SchemaIssue> = formatted.map((f) => ({
        path: f.path,
        message: f.message,
      }));
      return { ok: false, issues };
    },
    toJsonSchema(): Record<string, unknown> | undefined {
      try {
        const js = JSONSchema.make(schema);
        return js as unknown as Record<string, unknown>;
      } catch {
        return undefined;
      }
    },
  };
}

// ── Standard Schema path ────────────────────────────────────────────────────

/**
 * Normalize a Standard Schema path segment to a PropertyKey.
 * Segments may be raw PropertyKey or an object `{ key: PropertyKey }`.
 */
function normalizePathSegment(
  seg: PropertyKey | StandardSchemaV1.PathSegment,
): PropertyKey {
  if (
    typeof seg === "object" &&
    seg !== null &&
    "key" in seg
  ) {
    return (seg as StandardSchemaV1.PathSegment).key;
  }
  return seg as PropertyKey;
}

function fromStandardSchema<A>(std: StandardSchemaV1<unknown, A>): SchemaContract<A> {
  const props = std["~standard"];

  /**
   * Synchronous validation via the Standard Schema validate function.
   * If validate returns a Promise (async validator), we surface an issue
   * rather than silently dropping the result.
   */
  function runValidate(v: unknown): SchemaValidationResult<A> {
    let raw;
    try {
      raw = props.validate(v);
    } catch (e) {
      return { ok: false, issues: [{ path: [], message: String(e) }] };
    }

    if (raw instanceof Promise) {
      return {
        ok: false,
        issues: [{ path: [], message: "async validation unsupported" }],
      };
    }

    if (raw.issues === undefined) {
      // SuccessResult — TypeScript doesn't narrow this automatically because
      // the union is tagged by `issues` optionality, so we cast via unknown.
      const success = raw as StandardSchemaV1.SuccessResult<A>;
      return { ok: true, value: success.value };
    }

    const issues: ReadonlyArray<SchemaIssue> = raw.issues.map((issue) => ({
      path: (issue.path ?? []).map(normalizePathSegment),
      message: issue.message,
    }));
    return { ok: false, issues };
  }

  /**
   * Bridge Effect Schema built via Schema.declare.
   * Uses the simple predicate overload: Schema.declare(is, annotations).
   * The predicate returns true when Standard Schema validation succeeds.
   */
  const effectSchema: Schema.Schema<A> = Schema.declare(
    (input: unknown): input is A => {
      const result = props.validate(input);
      if (result instanceof Promise) return false;
      return result.issues === undefined;
    },
    { identifier: props.vendor ? `${props.vendor}.StandardSchema` : "StandardSchema" },
  );

  return {
    effectSchema,
    validate: runValidate,
    label: props.vendor,
    toJsonSchema(): Record<string, unknown> | undefined {
      // StandardJSONSchemaV1 extension: ~standard.jsonSchema.output({ target })
      // See https://github.com/standard-schema/standard-schema (v1 spec, StandardJSONSchemaV1)
      const jp = (props as { jsonSchema?: { output: (opts: { target: string }) => Record<string, unknown> } }).jsonSchema;
      if (jp && typeof jp.output === "function") {
        try {
          return jp.output({ target: "draft-07" });
        } catch {
          // fall through — converter may not support the requested target
        }
      }
      // Zod (the dominant Standard Schema vendor, and what the docs lead with) does
      // not implement the StandardJSONSchemaV1 extension until v4. For Zod 3.x we
      // convert via zod-to-json-schema. `std` IS the ZodType at runtime when
      // vendor === "zod" (the Standard Schema interface is layered onto the schema
      // object itself). Without this, the extraction prompt is blind to the shape.
      if (props.vendor === "zod") {
        try {
          return zodToJsonSchema(std as unknown as Parameters<typeof zodToJsonSchema>[0]) as Record<string, unknown>;
        } catch {
          // fall through — degrade to prompt+heal
        }
      }
      // Other vendors without a JSON Schema emitter: fall back to the prompt+heal path.
      return undefined;
    },
  };
}

// ── Public adapter ──────────────────────────────────────────────────────────

/**
 * Convert an Effect `Schema.Schema` or any Standard Schema v1 validator
 * into a uniform `SchemaContract<A>`.
 *
 * - Effect Schema path: validates via `Schema.decodeUnknownEither`; derives
 *   JSON Schema via `JSONSchema.make` (catches errors → undefined).
 * - Standard Schema path: validates via `"~standard".validate`; builds a
 *   bridge Effect Schema via `Schema.declare`; returns `undefined` for
 *   `toJsonSchema` (no standardized emission in v1).
 */
export function toSchemaContract<A>(
  input: StandardSchemaV1<unknown, A> | Schema.Schema<A>,
): SchemaContract<A> {
  if (isEffectSchema(input)) {
    // Cast: Effect Schema<A> implies Schema<A, A, never> for simple schemas.
    // Schemas with context (R ≠ never) cannot be validated synchronously; the
    // type constraint on decodeUnknownEither(schema: Schema<A, I, never>)
    // will catch that at call-sites that supply such schemas.
    return fromEffectSchema(input as Schema.Schema<A, A, never>);
  }
  return fromStandardSchema(input);
}
