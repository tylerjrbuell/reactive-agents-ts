import { Effect } from "effect";

/**
 * Shared schema utilities for provider adapters.
 *
 * `deepClone` replaces the `JSON.parse(JSON.stringify(...))` idiom that was
 * copy-pasted across the providers' `completeStructured` paths (gemini, openai,
 * local) and `toStrictToolSchema` (openai). Centralizing it removes the
 * copy-paste hazard (GH #156) while keeping behavior identical: a structural
 * deep copy of a JSON-serializable value.
 *
 * Inputs are always JSON-serializable schema objects (the output of
 * `Schema.encodedSchema(...)` or a plain JSON Schema), so the round-trip is
 * lossless. Do NOT use this for values containing functions, `undefined`,
 * `Date`, `Map`/`Set`, or cyclic references.
 *
 * The parameter is `unknown` (callers pass `Schema` instances whose compile-time
 * type does not match their runtime JSON shape); the caller supplies `T` to
 * describe the runtime shape of the cloned value.
 */
export const deepClone = <T>(value: unknown): T =>
  JSON.parse(JSON.stringify(value)) as T;

// ─── Tool-schema normalization (provider-agnostic) ───

/**
 * Minimal recursive JSON-Schema shape used for tool input schemas. Extra
 * keywords (description, title, format, ...) are preserved via the
 * `unknown`-typed index signature rather than widening to `any`.
 */
export interface ToolJSONSchema {
  type?: string | string[];
  properties?: Record<string, ToolJSONSchema>;
  required?: string[];
  additionalProperties?: boolean | ToolJSONSchema;
  items?: ToolJSONSchema | ToolJSONSchema[];
  anyOf?: ToolJSONSchema[];
  oneOf?: ToolJSONSchema[];
  allOf?: ToolJSONSchema[];
  enum?: unknown[];
  default?: unknown;
  [key: string]: unknown;
}

/** One repair applied by {@link normalizeToolSchema}. `path` is dot-joined from the root ("" = root). */
export interface SchemaRepair {
  readonly path: string;
  readonly kind:
    | "array-items"
    | "object-properties"
    | "root-object"
    | "type-array"
    | "required-pruned";
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const join = (path: string, ...seg: (string | number)[]): string =>
  [path, ...seg.map(String)].filter((s) => s !== "").join(".");

/** Repair one (already cloned) node in place, recursing into children. */
const repairNode = (
  node: Record<string, unknown>,
  path: string,
  repairs: SchemaRepair[],
): void => {
  // type arrays → anyOf (structural keywords move to the matching branch)
  if (Array.isArray(node.type)) {
    const types = node.type.filter((t): t is string => typeof t === "string");
    repairs.push({ path, kind: "type-array" });
    if (types.length === 1) {
      node.type = types[0];
    } else if (types.length > 1) {
      const branches = types.map((t) => {
        const branch: Record<string, unknown> = { type: t };
        if (t === "object") {
          for (const k of ["properties", "required", "additionalProperties"]) {
            if (k in node) {
              branch[k] = node[k];
              delete node[k];
            }
          }
        } else if (t === "array" && "items" in node) {
          branch.items = node.items;
          delete node.items;
        }
        return branch;
      });
      delete node.type;
      const existing = Array.isArray(node.anyOf) ? node.anyOf : [];
      node.anyOf = [...branches, ...existing];
    } else {
      delete node.type;
    }
  }

  if (node.type === "array" && node.items === undefined) {
    node.items = {};
    repairs.push({ path, kind: "array-items" });
  }

  if (
    node.type === "object" &&
    node.properties === undefined &&
    node.additionalProperties === undefined &&
    node.patternProperties === undefined
  ) {
    node.properties = {};
    repairs.push({ path, kind: "object-properties" });
  }

  if (Array.isArray(node.required)) {
    const kept = node.required.filter(
      (r): r is string => typeof r === "string" && r !== "",
    );
    if (kept.length !== node.required.length) {
      node.required = kept;
      repairs.push({ path, kind: "required-pruned" });
    }
  }

  if (isRecord(node.properties)) {
    for (const [key, child] of Object.entries(node.properties)) {
      if (isRecord(child)) repairNode(child, join(path, "properties", key), repairs);
    }
  }
  if (isRecord(node.items)) {
    repairNode(node.items, join(path, "items"), repairs);
  } else if (Array.isArray(node.items)) {
    node.items.forEach((child, i) => {
      if (isRecord(child)) repairNode(child, join(path, "items", i), repairs);
    });
  }
  for (const kw of ["anyOf", "oneOf", "allOf"] as const) {
    const branches = node[kw];
    if (Array.isArray(branches)) {
      branches.forEach((child, i) => {
        if (isRecord(child)) repairNode(child, join(path, kw, i), repairs);
      });
    }
  }
  if (isRecord(node.additionalProperties)) {
    repairNode(node.additionalProperties, join(path, "additionalProperties"), repairs);
  }
};

/**
 * Pure, recursive tool-schema repair run once before any provider-specific
 * transform. Walks `properties`, `items`, `anyOf`/`oneOf`/`allOf` and
 * `additionalProperties`. Repairs: array without `items` gets `items: {}`;
 * object with no `properties`/`additionalProperties`/`patternProperties` gets
 * `properties: {}`; non-object root is wrapped as an object (`value` property);
 * `type` arrays become `anyOf`; empty `required` entries are dropped.
 * A well-formed schema comes back deep-equal with zero repairs. Input is never mutated.
 */
export const normalizeToolSchema = (
  schema: unknown,
): { readonly schema: ToolJSONSchema; readonly repairs: readonly SchemaRepair[] } => {
  const repairs: SchemaRepair[] = [];
  if (!isRecord(schema)) {
    repairs.push({ path: "", kind: "root-object" });
    return { schema: { type: "object", properties: {} }, repairs };
  }
  let root = deepClone<Record<string, unknown>>(schema);
  const rootType = root.type;
  if (rootType === undefined) {
    root.type = "object";
    repairs.push({ path: "", kind: "root-object" });
  } else if (rootType !== undefined && rootType !== "object") {
    root = {
      type: "object",
      properties: { value: root },
      required: ["value"],
    };
    repairs.push({ path: "", kind: "root-object" });
  }
  repairNode(root, "", repairs);
  return { schema: root as ToolJSONSchema, repairs };
};

const STRICT_BANNED_KEYWORDS: readonly string[] = [
  "allOf",
  "oneOf",
  "not",
  "if",
  "then",
  "else",
  "dependentRequired",
  "dependentSchemas",
  "patternProperties",
  "propertyNames",
  "unevaluatedProperties",
  "$ref",
];

const STRICT_TYPES: ReadonlySet<string> = new Set([
  "string", "number", "integer", "boolean", "object", "array", "null",
]);

/** OpenAI strict limits (platform.openai.com structured-outputs guide, verified 2026-10-28). */
const STRICT_MAX_OBJECT_DEPTH = 10;
const STRICT_MAX_OBJECT_PROPERTIES = 5000;

interface StrictBudget {
  props: number;
}

const strictNode = (node: unknown, budget: StrictBudget, depth: number): boolean => {
  if (!isRecord(node)) return false;
  if (STRICT_BANNED_KEYWORDS.some((k) => k in node)) return false;
  if (Array.isArray(node.anyOf)) {
    return node.anyOf.length > 0 && node.anyOf.every((n) => strictNode(n, budget, depth));
  }
  if (typeof node.type !== "string" || !STRICT_TYPES.has(node.type)) return false;
  if (node.type === "object") {
    if (node.additionalProperties !== undefined && node.additionalProperties !== false) {
      return false;
    }
    if (depth + 1 > STRICT_MAX_OBJECT_DEPTH) return false;
    if (node.properties === undefined) return true;
    if (!isRecord(node.properties)) return false;
    budget.props += Object.keys(node.properties).length;
    if (budget.props > STRICT_MAX_OBJECT_PROPERTIES) return false;
    return Object.values(node.properties).every((n) => strictNode(n, budget, depth + 1));
  }
  if (node.type === "array") return strictNode(node.items, budget, depth);
  return true;
};

/**
 * True when the (normalized) schema can satisfy OpenAI structured-outputs
 * strict mode. False when the root is not an object, any node lacks a concrete
 * `type` (and is not an `anyOf` of compatible branches), an array lacks typed
 * `items`, an object allows additional properties, or any rejected keyword is
 * present: allOf, oneOf, not, if/then/else, dependentRequired,
 * dependentSchemas, patternProperties, propertyNames, unevaluatedProperties,
 * $ref; also false beyond 10 object nesting levels or 5000 object properties.
 * Verified 2026-10-28 against platform.openai.com/docs/guides/structured-outputs:
 * the docs list unsupported allOf/not/dependentRequired/dependentSchemas/
 * if/then/else; the extra bans (oneOf, patternProperties, propertyNames,
 * unevaluatedProperties, $ref) are deliberately conservative - falling back to
 * non-strict is safe, a strict-mode 400 is not.
 */
export const isStrictCompatible = (schema: ToolJSONSchema): boolean =>
  isRecord(schema) && schema.type === "object" && strictNode(schema, { props: 0 }, 0);

const reportedRepairs = new Set<string>();

/**
 * Normalize a tool's input schema and, on first sighting of a given
 * (tool, repairs) pair in this process, emit one structured
 * `tool-schema-repaired` warning (annotations: `toolName`, `repairs`) through
 * the Effect logger. Returns only the normalized schema. No console.
 */
export const normalizeToolSchemaFor = (
  toolName: string,
  schema: unknown,
): ToolJSONSchema => {
  const { schema: normalized, repairs } = normalizeToolSchema(schema);
  if (repairs.length > 0) {
    const key = `${toolName}\u0000${JSON.stringify(repairs)}`;
    if (!reportedRepairs.has(key)) {
      reportedRepairs.add(key);
      Effect.runSync(
        Effect.logWarning("tool-schema-repaired").pipe(
          Effect.annotateLogs({ event: "tool-schema-repaired", toolName, repairs: JSON.stringify(repairs) }),
        ),
      );
    }
  }
  return normalized;
};
