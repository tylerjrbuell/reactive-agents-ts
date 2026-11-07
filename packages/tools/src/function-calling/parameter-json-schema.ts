import type { ToolParameter } from "../types.js";

/**
 * The JSON types a `semantic: "file-content"` parameter accepts on the wire: a
 * string, or a JSON value the healing pipeline's value-shape stage serializes
 * to text (healing/value-shape-healer.ts). `null` is left out on purpose — a
 * null content stays a missing-parameter error.
 */
export const FILE_CONTENT_JSON_TYPES = ["string", "object", "array", "number", "boolean"] as const;

/**
 * Provider-neutral JSON schema for one tool parameter. Providers normalize it
 * further (`normalizeToolSchemaFor` in llm-provider turns a type array into
 * `anyOf`).
 */
export type ParameterJsonSchema = {
  readonly type: ToolParameter["type"] | typeof FILE_CONTENT_JSON_TYPES;
  readonly description: string;
  readonly enum?: readonly string[];
  readonly items?: { readonly type: string };
  readonly additionalProperties?: { readonly type: "string" | "number" | "boolean" };
};

/**
 * The ONE projection from a `ToolParameter` to its wire JSON schema. Every
 * path that hands tool parameters to a model goes through this, so a field
 * added to `ToolParameter` cannot silently drop on one path (drift pin:
 * tests/function-adapter.test.ts, "ToolParameter projection drift").
 *
 * - `type` — as declared; widened to {@link FILE_CONTENT_JSON_TYPES} when
 *   `semantic` is `"file-content"`.
 * - `items` — as declared; `{ type: "string" }` for an array without one
 *   (Gemini requires `items` on every array).
 * - `description`, `enum`, `additionalProperties` — carried when present.
 *
 * `name` and `required` belong to the parent object schema; `default` is
 * applied by the input validator and not sent to the model.
 */
export function toParameterJsonSchema(p: ToolParameter): ParameterJsonSchema {
  return {
    type: p.semantic === "file-content" ? FILE_CONTENT_JSON_TYPES : p.type,
    description: p.description,
    ...(p.type === "array" ? { items: p.items ?? { type: "string" } } : {}),
    ...(p.enum ? { enum: p.enum } : {}),
    ...(p.additionalProperties ? { additionalProperties: p.additionalProperties } : {}),
  };
}
