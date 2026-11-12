/**
 * Flat field lists <-> JSON Schema, for a field editor (name, type,
 * description, required). A builder's UI edits a list of fields; the agent
 * takes a JSON Schema (`.withOutputSchema(jsonSchema)` / `AgentConfig.outputSchema`).
 * Pure and dependency-free.
 */

/** The field types the editor can express. */
export type SchemaFieldType = "string" | "number" | "integer" | "boolean" | "string[]" | "number[]" | "enum";

/** One top-level field of an object schema. */
export interface SchemaField {
  readonly name: string;
  readonly type: SchemaFieldType;
  readonly description?: string;
  readonly required: boolean;
  /** Allowed values, for `type: "enum"`. */
  readonly enumValues?: readonly string[];
}

/** Field types in the order an editor offers them, with a label. */
export const SCHEMA_FIELD_TYPES: readonly { readonly value: SchemaFieldType; readonly label: string }[] = [
  { value: "string", label: "Text" },
  { value: "number", label: "Number" },
  { value: "integer", label: "Whole number" },
  { value: "boolean", label: "Yes / no" },
  { value: "enum", label: "One of" },
  { value: "string[]", label: "List of text" },
  { value: "number[]", label: "List of numbers" },
];

type Json = Record<string, unknown>;

const isRecord = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

const propertyOf = (f: SchemaField): Json => {
  const desc = f.description !== undefined && f.description.trim() !== "" ? { description: f.description.trim() } : {};
  switch (f.type) {
    case "string[]":
      return { type: "array", items: { type: "string" }, ...desc };
    case "number[]":
      return { type: "array", items: { type: "number" }, ...desc };
    case "enum":
      return { type: "string", enum: [...(f.enumValues ?? [])], ...desc };
    default:
      return { type: f.type, ...desc };
  }
};

/**
 * The object schema for a field list. Fields with a blank name are skipped and
 * a repeated name keeps its first definition. An empty list gives
 * `{ type: "object", properties: {} }`.
 */
export function fieldsToJsonSchema(fields: readonly SchemaField[]): Json {
  const properties: Json = {};
  const required: string[] = [];
  for (const f of fields) {
    const name = f.name.trim();
    if (name === "" || name in properties) continue;
    properties[name] = propertyOf({ ...f, name });
    if (f.required) required.push(name);
  }
  return { type: "object", properties, ...(required.length > 0 ? { required } : {}) };
}

const fieldOf = (name: string, prop: unknown, required: boolean): SchemaField | undefined => {
  if (!isRecord(prop)) return undefined;
  const description = typeof prop.description === "string" && prop.description !== "" ? { description: prop.description } : {};
  const base = { name, required, ...description };
  const t = prop.type;
  if (t === "string" && Array.isArray(prop.enum) && prop.enum.every((v) => typeof v === "string")) {
    return { ...base, type: "enum", enumValues: prop.enum as string[] };
  }
  if (t === "string" || t === "number" || t === "integer" || t === "boolean") return { ...base, type: t };
  if (t === "array" && isRecord(prop.items)) {
    if (prop.items.type === "string") return { ...base, type: "string[]" };
    if (prop.items.type === "number") return { ...base, type: "number[]" };
  }
  return undefined;
};

const canonical = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(canonical)
    : isRecord(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            // `required` is a set: its order carries no meaning.
            .map((k) => [k, k === "required" && Array.isArray(v[k]) ? [...(v[k] as unknown[])].sort() : canonical(v[k])]),
        )
      : v;

/** The result of reading a schema as a field list. */
export interface ParsedSchemaFields {
  /** The fields the editor can show. */
  readonly fields: readonly SchemaField[];
  /**
   * True when {@link fieldsToJsonSchema} of `fields` gives back the same schema.
   * False when the schema has parts the editor cannot express (nested objects,
   * extra keywords, a root other than an object): editing the fields would drop
   * them, so a UI offers JSON only.
   */
  readonly exact: boolean;
}

/**
 * Read a JSON Schema as a field list. A schema that is not an object schema
 * gives no fields and `exact: false`. Properties the editor cannot express are
 * left out of `fields` and make `exact` false.
 */
export function jsonSchemaToFields(schema: unknown): ParsedSchemaFields {
  if (!isRecord(schema) || schema.type !== "object") return { fields: [], exact: false };
  const props = isRecord(schema.properties) ? schema.properties : {};
  const required = new Set(Array.isArray(schema.required) ? schema.required.filter((r): r is string => typeof r === "string") : []);
  const fields: SchemaField[] = [];
  for (const [name, prop] of Object.entries(props)) {
    const f = fieldOf(name, prop, required.has(name));
    if (f !== undefined) fields.push(f);
  }
  const exact = JSON.stringify(canonical(fieldsToJsonSchema(fields))) === JSON.stringify(canonical(schema));
  return { fields, exact };
}
