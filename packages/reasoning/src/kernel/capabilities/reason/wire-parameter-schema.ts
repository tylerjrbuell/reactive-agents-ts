// Builds one tool parameter's provider wire-schema entry. Extracted from
// think.ts (placement rule): think.ts delegates here. The projection itself is
// the tools package's `toParameterJsonSchema` (the one ToolParameter -> JSON
// schema path), so a field added to `ToolParameter` cannot drop here. This
// module only applies the compact-profile rule.

import { toParameterJsonSchema, type ParameterJsonSchema } from "@reactive-agents/tools";
import { toToolParameter, type ToolParamSchema } from "../attend/tool-formatting.js";

/**
 * Build the wire JSON-schema fragment for a single tool parameter. Compact
 * profiles (the local tier) drop `description` by omitting the key; type,
 * items, enum and additionalProperties are always kept.
 */
export function buildWireParameterSchema(
  p: ToolParamSchema,
  compactProfile: boolean,
): Partial<ParameterJsonSchema> {
  const schema = toParameterJsonSchema(toToolParameter(p));
  if (!compactProfile) return schema;
  const { description: _dropped, ...compact } = schema;
  return compact;
}
