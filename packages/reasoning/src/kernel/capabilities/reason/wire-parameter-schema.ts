// Pure builder for one tool parameter's provider wire-schema entry.
// Extracted from think.ts (placement rule): think.ts delegates here.
// `additionalProperties` (typed map values for object params, e.g. http-get
// `headers`) is forwarded only when present; read structurally so this
// module does not depend on the tools-package field landing first.

interface WireParamInput {
  readonly name: string;
  readonly type?: string;
  readonly description?: string;
  readonly items?: { readonly type: string };
  readonly enum?: readonly string[];
  readonly additionalProperties?: { readonly type: string };
}

/** Build the wire JSON-schema fragment for a single tool parameter. */
export function buildWireParameterSchema(
  p: WireParamInput,
  compactProfile: boolean,
): Record<string, unknown> {
  return {
    type: p.type ?? "string",
    ...(compactProfile ? {} : { description: p.description }),
    // Gemini requires `items` on every array-type parameter
    ...(p.type === "array" ? { items: p.items ?? { type: "string" } } : {}),
    ...(p.enum ? { enum: p.enum } : {}),
    ...(p.additionalProperties ? { additionalProperties: p.additionalProperties } : {}),
  };
}
