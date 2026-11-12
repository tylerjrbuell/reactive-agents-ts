/**
 * Shared model of the Lab field editor (`components/agent-config/FieldEditor.svelte`): a
 * list of named, typed fields with a description and a required flag. Two Lab sections
 * edit their data through it: Variables (the `{{name}}` template values a run fills in)
 * and the Output schema (the typed object an agent returns, as JSON Schema).
 *
 * Hook for sub-agent inputs (no UI yet): runtime is adding `parameters` (a JSON Schema
 * object) to an agent tool. That editor is `FieldEditor` over `SchemaField` rows with
 * `fieldsToJsonSchema` / `jsonSchemaToFields` (ui-core), exactly as the Output schema
 * section does; only the Sub-agents section needs to mount it.
 */
import { SCHEMA_FIELD_TYPES, fieldsToJsonSchema, jsonSchemaToFields, type SchemaField } from "@reactive-agents/ui-core";
import type { VariableType } from "./types/agent-config.js";

/** What the editor needs of a row; a row may carry more (it is preserved on edit). */
export interface EditorField {
  name: string;
  type: string;
  description?: string;
  required: boolean;
  default?: string | number;
  enumValues?: readonly string[];
}

/** A type the editor offers. */
export interface FieldTypeOption {
  readonly value: string;
  readonly label: string;
}

/** Variable types in the order the editor offers them. */
export const VARIABLE_FIELD_TYPES: readonly { readonly value: VariableType; readonly label: string }[] = [
  { value: "string", label: "Text" },
  { value: "multiline", label: "Long text" },
  { value: "number", label: "Number" },
  { value: "enum", label: "One of" },
];

/** Output schema field types (ui-core). */
export const SCHEMA_TYPE_OPTIONS: readonly FieldTypeOption[] = SCHEMA_FIELD_TYPES;

/** A new, empty output-schema field (`field`, `field2`, ... so names stay distinct). */
export function newSchemaField(existing: readonly { readonly name: string }[]): SchemaField {
  const taken = new Set(existing.map((f) => f.name));
  let name = "field";
  for (let n = 2; taken.has(name); n++) name = `field${n}`;
  return { name, type: "string", required: false };
}

/** The Output schema section's view of its stored JSON text. */
export interface OutputSchemaView {
  /** `empty` = no schema; `fields` = the editor can show it all; `json` = it has parts the editor cannot express; `invalid` = not JSON. */
  readonly mode: "empty" | "fields" | "json" | "invalid";
  readonly fields: readonly SchemaField[];
}

/** Read the stored output-schema text (a JSON string, as the config keeps it). */
export function outputSchemaViewOf(text: string): OutputSchemaView {
  const t = text.trim();
  if (t === "") return { mode: "empty", fields: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(t);
  } catch {
    return { mode: "invalid", fields: [] };
  }
  const { fields, exact } = jsonSchemaToFields(parsed);
  return { mode: exact ? "fields" : "json", fields };
}

/** The stored text for an edited field list: pretty JSON Schema, or `""` when no field has a name (schema off). */
export function outputSchemaTextOf(fields: readonly SchemaField[]): string {
  const schema = fieldsToJsonSchema(fields);
  const props = schema.properties;
  return typeof props === "object" && props !== null && Object.keys(props).length > 0 ? JSON.stringify(schema, null, 2) : "";
}
