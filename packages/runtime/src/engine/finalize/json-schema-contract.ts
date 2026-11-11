/**
 * JSON Schema as an output schema.
 *
 * `.withOutputSchema()` takes an Effect Schema, a Standard Schema, or a plain
 * JSON Schema object. A JSON Schema is the only form that survives a trip
 * through `AgentConfig` (it is plain data), so this module is what lets a
 * schema be saved with an agent, edited in a UI, and applied again.
 *
 * The JSON Schema is wrapped as a Standard Schema v1 validator (vendor
 * `"json-schema"`) that also implements the StandardJSONSchemaV1 extension, so
 * `toSchemaContract()` handles it like any other vendor and
 * `contract.toJsonSchema()` returns the schema unchanged.
 *
 * Validation is deterministic and covers the JSON Schema subset that Effect's
 * `JSONSchema.make` emits and that people write by hand (draft-07 / 2020-12
 * object, array, scalar, enum, combinator and `$ref` keywords). A schema that
 * uses any other assertion keyword is refused when it is set
 * ({@link OutputSchemaError}), never validated loosely.
 */
import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { Schema } from "effect";
import { toSchemaContract, type SchemaContract } from "@reactive-agents/reasoning";
import { OutputSchemaError } from "../../errors/structured-output-error.js";

/** A JSON Schema document as a plain JSON object (for example `{ type: "object", properties: { ... } }`). */
export type JsonSchemaObject = { readonly [keyword: string]: unknown };

/** Any schema `.withOutputSchema()` and `runStream(task, { outputSchema })` accept. */
export type OutputSchemaInput<A = unknown> = StandardSchemaV1<unknown, A> | Schema.Schema<A> | JsonSchemaObject;

/** Any accepted output schema, whatever its value type (Effect Schemas are invariant, so `OutputSchemaInput<unknown>` would reject them). */
export type AnyOutputSchema = StandardSchemaV1 | Schema.Schema.AnyNoContext | JsonSchemaObject;

/** Keywords that carry no assertion; they are kept but never checked. */
const ANNOTATIONS: ReadonlySet<string> = new Set([
  "$schema", "$id", "$comment", "$defs", "definitions", "title", "description", "default", "examples",
  "format", "readOnly", "writeOnly", "deprecated", "contentMediaType", "contentEncoding",
]);

/** Assertion keywords the validator implements. Anything else is refused. */
const ASSERTIONS: ReadonlySet<string> = new Set([
  "type", "enum", "const", "$ref", "anyOf", "oneOf", "allOf", "not",
  "properties", "required", "additionalProperties", "patternProperties", "propertyNames",
  "minProperties", "maxProperties", "items", "additionalItems", "minItems", "maxItems", "uniqueItems",
  "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf",
  "minLength", "maxLength", "pattern",
]);

const TYPES: ReadonlySet<string> = new Set(["object", "array", "string", "number", "integer", "boolean", "null"]);

type Issue = { readonly path: ReadonlyArray<PropertyKey>; readonly message: string };
type Node = JsonSchemaObject | boolean;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * True for a plain JSON Schema object: a plain object (not a class instance,
 * not a function) that is neither an Effect Schema nor a Standard Schema.
 */
export function isJsonSchemaObject(input: unknown): input is JsonSchemaObject {
  if (!isRecord(input)) return false;
  const proto = Object.getPrototypeOf(input);
  if (proto !== Object.prototype && proto !== null) return false;
  return !("~standard" in input) && !("ast" in input);
}

const jsonEqual = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => jsonEqual(x, b[i]));
  if (isRecord(a) && isRecord(b)) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((k) => k in b && jsonEqual(a[k], b[k]));
  }
  return false;
};

const typeOf = (v: unknown): string =>
  v === null ? "null" : Array.isArray(v) ? "array" : typeof v === "number" ? (Number.isInteger(v) ? "integer" : "number") : typeof v;

const matchesType = (v: unknown, t: string): boolean => {
  const actual = typeOf(v);
  return actual === t || (t === "number" && actual === "integer");
};

/** Resolve a local `$ref` (`#/$defs/Name` or `#/definitions/Name`) against the root schema. */
const resolveRef = (root: JsonSchemaObject, ref: string): Node | undefined => {
  const m = /^#\/(\$defs|definitions)\/(.+)$/.exec(ref);
  if (!m) return undefined;
  const defs = root[m[1]!];
  const name = m[2]!.replace(/~1/g, "/").replace(/~0/g, "~");
  if (!isRecord(defs)) return undefined;
  const target = defs[name];
  return typeof target === "boolean" || isRecord(target) ? target : undefined;
};

const pointer = (path: ReadonlyArray<string | number>): string =>
  path.length === 0 ? "the schema root" : `"/${path.join("/")}"`;

/** Every problem that keeps `node` from being validated faithfully. Empty = supported. */
function checkNode(node: unknown, root: JsonSchemaObject, path: ReadonlyArray<string | number>, out: string[]): void {
  if (typeof node === "boolean") return;
  if (!isRecord(node)) {
    out.push(`${pointer(path)} must be a JSON Schema object or boolean`);
    return;
  }
  const sub = (key: string | number, child: unknown, at: ReadonlyArray<string | number> = [...path, key]) =>
    checkNode(child, root, at, out);
  for (const [key, value] of Object.entries(node)) {
    if (ANNOTATIONS.has(key)) continue;
    if (!ASSERTIONS.has(key)) {
      out.push(`unsupported keyword "${key}" at ${pointer(path)}`);
      continue;
    }
    switch (key) {
      case "type": {
        const ts = Array.isArray(value) ? value : [value];
        if (ts.length === 0 || ts.some((t) => typeof t !== "string" || !TYPES.has(t))) out.push(`invalid "type" at ${pointer(path)}`);
        break;
      }
      case "enum":
        if (!Array.isArray(value)) out.push(`"enum" must be an array at ${pointer(path)}`);
        break;
      case "$ref":
        if (typeof value !== "string" || resolveRef(root, value) === undefined) {
          out.push(`unresolvable "$ref" ${JSON.stringify(value)} at ${pointer(path)} (only local #/$defs/... and #/definitions/... refs)`);
        }
        break;
      case "anyOf": case "oneOf": case "allOf":
        if (!Array.isArray(value) || value.length === 0) out.push(`"${key}" must be a non-empty array at ${pointer(path)}`);
        else value.forEach((child, i) => sub(i, child, [...path, key, i]));
        break;
      case "not": case "additionalProperties": case "propertyNames": case "additionalItems":
        sub(key, value);
        break;
      case "properties": case "patternProperties":
        if (!isRecord(value)) out.push(`"${key}" must be an object at ${pointer(path)}`);
        else for (const [k, child] of Object.entries(value)) {
          if (key === "patternProperties") {
            try { new RegExp(k, "u"); } catch { out.push(`invalid pattern ${JSON.stringify(k)} at ${pointer(path)}`); }
          }
          sub(k, child, [...path, key, k]);
        }
        break;
      case "required":
        if (!Array.isArray(value) || value.some((r) => typeof r !== "string")) out.push(`"required" must be an array of strings at ${pointer(path)}`);
        break;
      case "items":
        if (Array.isArray(value)) value.forEach((child, i) => sub(i, child, [...path, "items", i]));
        else sub(key, value);
        break;
      case "uniqueItems":
        if (typeof value !== "boolean") out.push(`"uniqueItems" must be a boolean at ${pointer(path)}`);
        break;
      case "pattern":
        try { new RegExp(String(value), "u"); } catch { out.push(`invalid "pattern" at ${pointer(path)}`); }
        break;
      default:
        // const accepts any JSON value; the remaining keywords are numeric bounds.
        if (key !== "const" && (typeof value !== "number" || !Number.isFinite(value))) {
          out.push(`"${key}" must be a finite number at ${pointer(path)}`);
        }
    }
  }
}

/** Validate `value` against `node`, appending one issue per failed assertion. */
function validateNode(value: unknown, node: Node, root: JsonSchemaObject, path: PropertyKey[], out: Issue[]): void {
  if (node === true) return;
  if (node === false) {
    out.push({ path, message: "no value is allowed here" });
    return;
  }
  const fail = (message: string) => out.push({ path: [...path], message });
  const passes = (child: Node, v: unknown = value): boolean => {
    const local: Issue[] = [];
    validateNode(v, child, root, path, local);
    return local.length === 0;
  };
  if (typeof node.$ref === "string") {
    const target = resolveRef(root, node.$ref);
    if (target !== undefined) validateNode(value, target, root, path, out);
  }
  if (node.type !== undefined) {
    const ts = (Array.isArray(node.type) ? node.type : [node.type]) as string[];
    if (!ts.some((t) => matchesType(value, t))) {
      fail(`expected ${ts.join(" or ")}, got ${typeOf(value)}`);
      return;
    }
  }
  if (Array.isArray(node.enum) && !node.enum.some((e) => jsonEqual(e, value))) {
    fail(`expected one of ${JSON.stringify(node.enum)}`);
  }
  if ("const" in node && !jsonEqual(node.const, value)) fail(`expected ${JSON.stringify(node.const)}`);
  if (Array.isArray(node.allOf)) for (const child of node.allOf as Node[]) validateNode(value, child, root, path, out);
  if (Array.isArray(node.anyOf) && !(node.anyOf as Node[]).some((child) => passes(child))) fail("matches none of the anyOf alternatives");
  if (Array.isArray(node.oneOf)) {
    const hits = (node.oneOf as Node[]).filter((child) => passes(child)).length;
    if (hits !== 1) fail(`must match exactly one oneOf alternative (matched ${hits})`);
  }
  if (node.not !== undefined && passes(node.not as Node)) fail("must not match the \"not\" schema");

  if (typeof value === "number") {
    if (typeof node.minimum === "number" && value < node.minimum) fail(`must be >= ${node.minimum}`);
    if (typeof node.maximum === "number" && value > node.maximum) fail(`must be <= ${node.maximum}`);
    if (typeof node.exclusiveMinimum === "number" && value <= node.exclusiveMinimum) fail(`must be > ${node.exclusiveMinimum}`);
    if (typeof node.exclusiveMaximum === "number" && value >= node.exclusiveMaximum) fail(`must be < ${node.exclusiveMaximum}`);
    if (typeof node.multipleOf === "number" && node.multipleOf > 0 && !Number.isInteger(value / node.multipleOf)) {
      fail(`must be a multiple of ${node.multipleOf}`);
    }
  }
  if (typeof value === "string") {
    const length = [...value].length;
    if (typeof node.minLength === "number" && length < node.minLength) fail(`must have at least ${node.minLength} characters`);
    if (typeof node.maxLength === "number" && length > node.maxLength) fail(`must have at most ${node.maxLength} characters`);
    if (typeof node.pattern === "string" && !new RegExp(node.pattern, "u").test(value)) fail(`must match pattern ${node.pattern}`);
  }
  if (Array.isArray(value)) {
    if (typeof node.minItems === "number" && value.length < node.minItems) fail(`must have at least ${node.minItems} items`);
    if (typeof node.maxItems === "number" && value.length > node.maxItems) fail(`must have at most ${node.maxItems} items`);
    if (node.uniqueItems === true && value.some((v, i) => value.findIndex((w) => jsonEqual(v, w)) !== i)) fail("items must be unique");
    if (Array.isArray(node.items)) {
      const tuple = node.items as Node[];
      value.forEach((v, i) => {
        const child = i < tuple.length ? tuple[i] : (node.additionalItems as Node | undefined);
        if (child !== undefined) validateNode(v, child, root, [...path, i], out);
      });
    } else if (node.items !== undefined) {
      value.forEach((v, i) => validateNode(v, node.items as Node, root, [...path, i], out));
    }
  }
  if (isRecord(value)) {
    const keys = Object.keys(value);
    const props = isRecord(node.properties) ? (node.properties as Record<string, Node>) : {};
    const patterns = isRecord(node.patternProperties)
      ? Object.entries(node.patternProperties as Record<string, Node>).map(([p, s]) => [new RegExp(p, "u"), s] as const)
      : [];
    if (typeof node.minProperties === "number" && keys.length < node.minProperties) fail(`must have at least ${node.minProperties} properties`);
    if (typeof node.maxProperties === "number" && keys.length > node.maxProperties) fail(`must have at most ${node.maxProperties} properties`);
    if (Array.isArray(node.required)) {
      for (const r of node.required as string[]) if (!(r in value)) out.push({ path: [...path, r], message: "is missing" });
    }
    for (const key of keys) {
      if (node.propertyNames !== undefined) validateNode(key, node.propertyNames as Node, root, [...path, key], out);
      const matched = patterns.filter(([re]) => re.test(key));
      for (const [, s] of matched) validateNode(value[key], s, root, [...path, key], out);
      if (key in props) validateNode(value[key], props[key]!, root, [...path, key], out);
      else if (matched.length === 0 && node.additionalProperties !== undefined) {
        if (node.additionalProperties === false) out.push({ path: [...path, key], message: "is not allowed" });
        else validateNode(value[key], node.additionalProperties as Node, root, [...path, key], out);
      }
    }
  }
}

/**
 * Wrap a JSON Schema as a Standard Schema v1 validator (vendor `"json-schema"`)
 * that also exposes the schema through the StandardJSONSchemaV1 extension.
 *
 * @param schema - A JSON Schema object.
 * @returns The validator; `~standard.jsonSchema.output()` returns a copy of `schema` as given.
 * @throws OutputSchemaError when the schema uses a keyword the validator does not implement, or is malformed.
 */
export function jsonSchemaValidator(schema: JsonSchemaObject): StandardSchemaV1<unknown, unknown> {
  const root: JsonSchemaObject = structuredClone(schema);
  const problems: string[] = [];
  checkNode(root, root, [], problems);
  for (const defsKey of ["$defs", "definitions"] as const) {
    const defs = root[defsKey];
    if (isRecord(defs)) for (const [name, def] of Object.entries(defs)) checkNode(def, root, [defsKey, name], problems);
  }
  if (problems.length > 0) {
    throw new OutputSchemaError({ message: `Unsupported JSON Schema for withOutputSchema(): ${problems.join("; ")}` });
  }
  const props = {
    version: 1 as const,
    vendor: "json-schema",
    validate: (value: unknown): StandardSchemaV1.Result<unknown> => {
      const issues: Issue[] = [];
      validateNode(value, root, root, [], issues);
      return issues.length === 0 ? { value } : { issues };
    },
    jsonSchema: { input: () => root, output: () => root },
  };
  return { "~standard": props };
}

/**
 * The schema contract for any accepted output schema: a JSON Schema object is
 * wrapped by {@link jsonSchemaValidator}; Effect and Standard Schemas go to
 * `toSchemaContract()` unchanged.
 *
 * @throws OutputSchemaError for a JSON Schema the validator cannot check faithfully.
 */
export function toOutputSchemaContract<A>(input: OutputSchemaInput<A> | AnyOutputSchema): SchemaContract<A> {
  if (isJsonSchemaObject(input)) return toSchemaContract(jsonSchemaValidator(input)) as SchemaContract<A>;
  return toSchemaContract(input as StandardSchemaV1<unknown, A> | Schema.Schema<A>);
}
