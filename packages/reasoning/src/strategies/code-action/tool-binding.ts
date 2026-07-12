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

// ── Identifier sanitization ───────────────────────────────────────────────────
//
// Every REAL builtin tool name is hyphenated (file-write, code-execute,
// web-search) — syntactically INVALID as a JS identifier. The prompt used to
// declare `async function file-write(...)` and the sandbox passed the raw name
// as a `new Function` parameter, so code-action hard-failed with
// "Unexpected token '-'" the moment a real builtin was involved (2026-07-11
// probe p7). One sanitizer, used by BOTH the prompt bindings and the sandbox
// parameter list, keeps the two sides in lockstep; dispatch stays keyed by the
// ORIGINAL tool name.

/** Sanitize one tool name into a valid JS identifier (no collision handling). */
export function toJsIdentifier(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_$]/g, "_");
  return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned;
}

/**
 * Sanitize a tool-name list into UNIQUE JS identifiers, index-aligned with the
 * input. Collisions (e.g. `a-b` vs `a_b`) dedupe deterministically by
 * first-come-keeps-the-name; later colliders get `_` suffixes.
 */
export function buildToolParamNames(names: readonly string[]): string[] {
  const used = new Set<string>();
  return names.map((n) => {
    let id = toJsIdentifier(n);
    while (used.has(id)) id = `${id}_`;
    used.add(id);
    return id;
  });
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

function generateFunctionSignature(tool: ToolSpec, fnName: string): string {
  const { name, description, parameters } = tool;
  const required = new Set(parameters.required ?? []);
  const params = Object.entries(parameters.properties)
    .map(([paramName, schema]) => {
      const tsType = toTsType(schema.type, schema.enum);
      const optional = required.has(paramName) ? "" : "?";
      return `${paramName}${optional}: ${tsType}`;
    })
    .join("; ");

  // Name the underlying tool when the identifier differs, so the mapping is
  // visible to the model (and to anyone reading the prompt).
  const doc = fnName === name ? description : `${description} (tool: ${name})`;
  return [
    `/** ${doc} */`,
    `declare async function ${fnName}(params: { ${params} }): Promise<unknown>;`,
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
  const fnNames = buildToolParamNames(tools.map((t) => t.name));
  return tools.map((t, i) => generateFunctionSignature(t, fnNames[i]!)).join("\n\n");
}
