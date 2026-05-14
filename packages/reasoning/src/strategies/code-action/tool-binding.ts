// File: src/strategies/code-action/tool-binding.ts
//
// Converts an array of ToolSpec (JSON-Schema-style) into TypeScript ambient
// function declarations that the code-action LLM prompt can use as a
// "standard library" of available tools. The generated string is injected into
// the system prompt / preamble so the model knows exactly what async functions
// it can call and what parameter shapes they accept.

export interface ToolParamPropertySchema {
  type: string;
  description?: string;
  enum?: string[];
}

export interface ToolParameters {
  type: "object";
  properties: Record<string, ToolParamPropertySchema>;
  required?: string[];
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: ToolParameters;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toTsType(jsonType: string, enumValues?: string[]): string {
  if (enumValues && enumValues.length > 0) {
    return enumValues.map((v) => JSON.stringify(v)).join(" | ");
  }
  switch (jsonType) {
    case "string":
      return "string";
    case "number":
    case "integer":
      return "number";
    case "boolean":
      return "boolean";
    case "array":
      return "unknown[]";
    case "object":
      return "Record<string, unknown>";
    default:
      return "unknown";
  }
}

function generateFunctionSignature(tool: ToolSpec): string {
  const { name, description, parameters } = tool;
  const required = new Set(parameters.required ?? []);
  const params = Object.entries(parameters.properties)
    .map(([paramName, schema]) => {
      const tsType = toTsType(schema.type, schema.enum);
      const optional = required.has(paramName) ? "" : "?";
      return `${paramName}${optional}: ${tsType}`;
    })
    .join("; ");

  return [
    `/** ${description} */`,
    `declare async function ${name}(params: { ${params} }): Promise<unknown>;`,
  ].join("\n");
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Generates TypeScript ambient function declarations for each tool in the
 * provided array. The result is a multi-line string suitable for injection
 * into a code-action prompt preamble.
 *
 * Returns an empty string when `tools` is empty.
 */
export function generateToolBindings(tools: ToolSpec[]): string {
  if (tools.length === 0) return "";
  return tools.map(generateFunctionSignature).join("\n\n");
}
