import type { MCPToolSchema } from "../types.js";

/**
 * The slice of MCP tool annotations read-only classification looks at
 * (MCP spec `ToolAnnotations`). All hints are advisory and server-supplied.
 */
export type MCPToolAnnotations = NonNullable<MCPToolSchema["annotations"]>;

/**
 * Operator-declared read-only marking for an MCP server. The operator's
 * promise, never inferred from server output.
 */
export interface MCPReadOnlyDeclaration {
  /**
   * - `true` — the operator promises EVERY tool on this server is read-only.
   * - `string[]` — only the listed tool names (without the `server/` prefix).
   */
  readonly readOnly?: boolean | readonly string[];
  /**
   * Operator trusts this server's `readOnlyHint` annotation. Without it the
   * annotation is ignored: a malicious or buggy server can lie.
   */
  readonly trustAnnotations?: boolean;
}

/**
 * Decide `mutatesExternalState` for one MCP tool: `false` (declared
 * read-only), `true` (declared to write) or `undefined` (unclassified, effect
 * `"unknown"`). Fails closed: `false` needs an operator promise (`readOnly`)
 * or a trusted `readOnlyHint: true`.
 *
 * Precedence, first match wins:
 * 1. Write signals: `destructiveHint: true` or an explicit `readOnlyHint:
 *    false` → `true` (write), even from an untrusted server and even if the
 *    operator declared the tool read-only. A server can only narrow here, so
 *    a server that says it writes is believed.
 * 2. `openWorldHint: true` → `undefined` (unknown). It says the tool reaches
 *    outside, not that it writes, but it blocks a read classification.
 * 3. Read-only: operator `readOnly` (all or listed) or a trusted
 *    `readOnlyHint: true` → `false` (read).
 * 4. Otherwise `undefined` (unknown).
 */
export const classifyMCPToolMutation = (
  declaration: MCPReadOnlyDeclaration,
  toolName: string,
  annotations: MCPToolAnnotations | undefined,
): boolean | undefined => {
  if (annotations?.destructiveHint === true || annotations?.readOnlyHint === false) return true;
  if (annotations?.openWorldHint === true) return undefined;
  const { readOnly, trustAnnotations } = declaration;
  if (readOnly === true) return false;
  if (Array.isArray(readOnly) && readOnly.includes(toolName)) return false;
  if (trustAnnotations === true && annotations?.readOnlyHint === true) return false;
  return undefined;
};

/** Copy only the known boolean hints from an untrusted MCP annotations object. */
export const pickMCPToolAnnotations = (raw: unknown): MCPToolAnnotations | undefined => {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  const out: { -readonly [K in keyof MCPToolAnnotations]: MCPToolAnnotations[K] } = {};
  for (const key of ["readOnlyHint", "destructiveHint", "openWorldHint", "idempotentHint"] as const) {
    if (typeof r[key] === "boolean") out[key] = r[key];
  }
  return Object.keys(out).length > 0 ? out : undefined;
};

/** Build a `toolSchemas` entry from an SDK `listTools()` tool. */
export const toMCPToolSchemaEntry = (t: {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: unknown;
  readonly outputSchema?: unknown;
  readonly annotations?: unknown;
}): MCPToolSchema => {
  const annotations = pickMCPToolAnnotations(t.annotations);
  const { outputSchema } = t;
  const hasOutputSchema = typeof outputSchema === "object" && outputSchema !== null && !Array.isArray(outputSchema);
  return {
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema as Record<string, unknown> | undefined,
    ...(hasOutputSchema ? { outputSchema: outputSchema as Record<string, unknown> } : {}),
    ...(annotations ? { annotations } : {}),
  };
};
