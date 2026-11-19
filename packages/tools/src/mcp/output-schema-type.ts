// Maps an MCP tool's `outputSchema` (JSON Schema) to a compact TypeScript-like
// type string for `ToolDefinition.returnType`. Code-action bindings render it
// as `Returns: <type>`, so the model writes correct property access on its
// first attempt instead of guessing the result shape.
//
// Pure and total: unexpected input never throws. A schema with nothing useful
// to say (not an object, or renders to bare `unknown`) yields `undefined`, and
// the caller omits `returnType`.

/** Default cap on the rendered type string, in characters. */
export const OUTPUT_TYPE_MAX_LENGTH = 240;

/** Default object nesting depth rendered before `{ ... }`. */
export const OUTPUT_TYPE_MAX_DEPTH = 3;

/** Hard bound on schema recursion (arrays and unions included), so even a cyclic input terminates. */
const MAX_NODE_DEPTH = 12;

/** Union members rendered before `| ...`. */
const MAX_UNION_MEMBERS = 6;

type Limits = { readonly maxDepth: number; readonly maxProps: number };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

const propKey = (name: string): string => (IDENTIFIER.test(name) ? name : JSON.stringify(name));

const literal = (v: unknown): string | undefined =>
  typeof v === "string" || typeof v === "number" || typeof v === "boolean" || v === null
    ? JSON.stringify(v)
    : undefined;

const union = (members: readonly string[]): string => {
  const unique = [...new Set(members)];
  if (unique.includes("unknown")) return "unknown";
  if (unique.length === 0) return "unknown";
  const shown = unique.slice(0, MAX_UNION_MEMBERS);
  return unique.length > MAX_UNION_MEMBERS ? `${shown.join(" | ")} | ...` : shown.join(" | ");
};

/** Wrap a union in parens before appending `[]`. */
const arrayOf = (item: string): string => (item.includes(" | ") ? `(${item})[]` : `${item}[]`);

const primitive = (type: string): string | undefined => {
  switch (type) {
    case "string":
    case "number":
    case "boolean":
    case "null":
      return type;
    case "integer":
      return "number";
    default:
      return undefined;
  }
};

const renderObject = (
  s: Record<string, unknown>,
  objectDepth: number,
  nodeDepth: number,
  limits: Limits,
): string => {
  const props = isRecord(s.properties) ? Object.entries(s.properties) : [];
  if (props.length === 0) {
    if (isRecord(s.additionalProperties)) {
      return `Record<string, ${render(s.additionalProperties, objectDepth, nodeDepth + 1, limits)}>`;
    }
    return "object";
  }
  if (objectDepth >= limits.maxDepth) return "{ ... }";
  const required = new Set(Array.isArray(s.required) ? s.required.filter((r) => typeof r === "string") : []);
  const shown = props.slice(0, limits.maxProps).map(([name, sub]) => {
    const optional = required.has(name) ? "" : "?";
    return `${propKey(name)}${optional}: ${render(sub, objectDepth + 1, nodeDepth + 1, limits)}`;
  });
  if (props.length > limits.maxProps) shown.push("...");
  return `{ ${shown.join("; ")} }`;
};

const render = (schema: unknown, objectDepth: number, nodeDepth: number, limits: Limits): string => {
  if (!isRecord(schema) || nodeDepth > MAX_NODE_DEPTH) return "unknown";

  if ("const" in schema) return literal(schema.const) ?? "unknown";
  if (Array.isArray(schema.enum)) {
    const members = schema.enum.map(literal);
    return members.every((m): m is string => m !== undefined) ? union(members) : "unknown";
  }

  const alternatives = Array.isArray(schema.anyOf) ? schema.anyOf : Array.isArray(schema.oneOf) ? schema.oneOf : undefined;
  if (alternatives) return union(alternatives.map((a) => render(a, objectDepth, nodeDepth + 1, limits)));

  const { type } = schema;
  if (Array.isArray(type)) {
    return union(type.map((t) => (typeof t === "string" ? render({ ...schema, type: t }, objectDepth, nodeDepth + 1, limits) : "unknown")));
  }
  if (type === "array") {
    return isRecord(schema.items) ? arrayOf(render(schema.items, objectDepth, nodeDepth + 1, limits)) : "unknown[]";
  }
  if (type === "object" || (type === undefined && isRecord(schema.properties))) {
    return renderObject(schema, objectDepth, nodeDepth, limits);
  }
  return typeof type === "string" ? (primitive(type) ?? "unknown") : "unknown";
};

/**
 * Successively tighter render settings, tried in order until one fits the
 * length cap: shallower nesting first, then fewer properties per object.
 */
const attempts = (maxDepth: number): readonly Limits[] => {
  const out: Limits[] = [];
  for (let d = maxDepth; d >= 1; d--) out.push({ maxDepth: d, maxProps: Number.POSITIVE_INFINITY });
  for (const p of [8, 4, 2]) out.push({ maxDepth: 1, maxProps: p });
  return out;
};

/**
 * Render a JSON Schema as a compact TypeScript-like type string.
 *
 * Objects become `{ a: string; b?: number }` (`?` marks non-required keys),
 * arrays `T[]`, enums and `anyOf`/`oneOf` unions, `integer` becomes `number`.
 * Objects nested deeper than `maxDepth` render as `{ ... }`. When the result
 * exceeds `maxLength`, nesting and then per-object property counts shrink
 * (omitted keys shown as `...`); a result that still does not fit is cut at
 * `maxLength` and ends in `...`.
 *
 * @param schema - Any value; typically an MCP tool's `outputSchema`.
 * @param options - Optional `maxDepth` (default 3) and `maxLength` (default 240).
 * @returns The type string, or `undefined` when the schema is not an object or
 *   says nothing beyond `unknown`.
 *
 * @example
 * ```ts
 * jsonSchemaToTypeString({
 *   type: "object",
 *   properties: { websites: { type: "array", items: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } } },
 *   required: ["websites"],
 * });
 * // "{ websites: { id: string }[] }"
 * ```
 */
export const jsonSchemaToTypeString = (
  schema: unknown,
  options: { readonly maxDepth?: number; readonly maxLength?: number } = {},
): string | undefined => {
  if (!isRecord(schema)) return undefined;
  const maxLength = Math.max(8, options.maxLength ?? OUTPUT_TYPE_MAX_LENGTH);
  const maxDepth = Math.max(1, options.maxDepth ?? OUTPUT_TYPE_MAX_DEPTH);
  let last = "unknown";
  for (const limits of attempts(maxDepth)) {
    last = render(schema, 0, 0, limits);
    if (last === "unknown") return undefined;
    if (last.length <= maxLength) return last;
  }
  return `${last.slice(0, maxLength - 3)}...`;
};
