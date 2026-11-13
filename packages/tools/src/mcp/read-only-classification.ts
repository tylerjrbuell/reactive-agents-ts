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
 * Decide `mutatesExternalState` for one MCP tool. Returns `false` (declared
 * read-only) or `undefined` (unclassified, treated as NOT read-only by
 * `isReadOnlyTool`). Never returns `true`; fails closed.
 *
 * `destructiveHint: true` or `openWorldHint: true` always wins: the tool is
 * left unclassified even if the operator listed it. The server only ever
 * narrows here, so honoring those hints is safe without trust.
 */
export const classifyMCPToolMutation = (
  declaration: MCPReadOnlyDeclaration,
  toolName: string,
  annotations: MCPToolAnnotations | undefined,
): false | undefined => {
  if (annotations?.destructiveHint === true || annotations?.openWorldHint === true) {
    return undefined;
  }
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
  readonly annotations?: unknown;
}): MCPToolSchema => {
  const annotations = pickMCPToolAnnotations(t.annotations);
  return {
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema as Record<string, unknown> | undefined,
    ...(annotations ? { annotations } : {}),
  };
};
