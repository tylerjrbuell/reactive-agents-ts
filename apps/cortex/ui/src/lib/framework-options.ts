/**
 * Which framework config fields "All framework options" (`AdvancedFrameworkConfig`)
 * renders, and with which widget. Fields come from the capability manifest
 * (`configFields`); a field renders when its type has a generic widget, or when
 * its shape is listed here, and when no curated section sets it
 * (`isCuratedConfigPath`, from the section registry). Pure.
 */
import { isCuratedConfigPath } from "./agent-config-sections.js";
import type { ConfigFieldDescriptor } from "./capabilities.js";

/** Manifest types with a generic widget. */
const RENDERABLE_TYPES: ReadonlySet<ConfigFieldDescriptor["type"]> = new Set(["string", "number", "boolean", "enum"]);

/**
 * Collection-shaped fields: the manifest does not report element shapes, so a
 * list / record renders through `ListField` only when listed here.
 */
export type CollectionShape =
  | { readonly mode: "list"; readonly placeholder: string }
  | { readonly mode: "record"; readonly valueKind: "number" | readonly string[]; readonly placeholder: string };

/** Collection fields by path. `tools.builtins` suggestions are added by the component (served toolsets). */
export const COLLECTION_FIELDS: Readonly<Record<string, CollectionShape>> = {
  "tools.builtins": { mode: "list", placeholder: "Toolset or tool name" },
  "tools.focusedTools": { mode: "list", placeholder: "Tool shown in the prompt" },
  "tools.maxCallsPerTool": { mode: "record", valueKind: "number", placeholder: "Tool name" },
  "tools.riskLevels": { mode: "record", valueKind: ["low", "medium", "high", "critical"], placeholder: "Tool name" },
  "requiredTools.tools": { mode: "list", placeholder: "Tool that must be called" },
};

/** One option of a mixed-type choice field. */
export type ChoiceValue = string | boolean;

/**
 * Fields whose schema is a union of literals of different types (the manifest
 * reports them as `unknown`): rendered as a select of these values.
 */
export const CHOICE_FIELDS: Readonly<Record<string, readonly ChoiceValue[]>> = {
  // `ReasoningOptions.observationSummary`: true | false | "auto".
  "reasoning.observationSummary": [true, false, "auto"],
};

/** Whether the generic renderer has a widget for this field. */
export function hasGenericWidget(f: ConfigFieldDescriptor): boolean {
  return RENDERABLE_TYPES.has(f.type) || f.path in COLLECTION_FIELDS || f.path in CHOICE_FIELDS;
}

/** The fields "All framework options" renders: has a widget, and no curated section sets it. */
export function genericConfigFields(fields: readonly ConfigFieldDescriptor[]): ConfigFieldDescriptor[] {
  return fields.filter((f) => hasGenericWidget(f) && !isCuratedConfigPath(f.path));
}

/** A choice value as a `<select>` option value (`true` and `"true"` stay distinct). */
export function choiceKey(v: ChoiceValue): string {
  return JSON.stringify(v);
}

/** The choice for a `<select>` value; `undefined` for "Default" (empty) or an unknown key. */
export function choiceFromKey(path: string, key: string): ChoiceValue | undefined {
  return CHOICE_FIELDS[path]?.find((v) => choiceKey(v) === key);
}
