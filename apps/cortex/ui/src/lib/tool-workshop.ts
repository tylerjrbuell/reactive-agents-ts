/**
 * Lab Tools tab (ToolWorkshop): catalog types and the pure rules behind the
 * catalog list, the test runner's default arguments and the MCP server form.
 */
import { formatRelativeTime } from "@reactive-agents/ui-core";

/** Where a catalog tool comes from. */
export type ToolKind = "built-in" | "meta" | "mcp" | "custom";
/** User-creatable origins: one create panel, no separate page per type. */
export type CreateKind = "custom" | "mcp";

/** One declared tool parameter (GET /api/tools/catalog). */
export type CatalogParam = {
  name: string;
  type: string;
  required: boolean;
  description: string;
  enum?: string[];
};

/** One row of GET /api/tools/catalog. */
export type CatalogEntry = {
  id: string;
  kind: ToolKind;
  name: string;
  displayName: string;
  description: string;
  parameters: CatalogParam[];
  executable: boolean;
  executableHint?: string;
  serverId?: string;
  serverName?: string;
  disabled?: boolean;
  metrics: {
    callCount: number;
    successRatePct: number | null;
    avgDurationMs: number | null;
    lastUsedAt: number | null;
  };
};

/** One row of GET /api/mcp-servers. */
export type McpListRow = {
  serverId: string;
  name: string;
  config: Record<string, unknown>;
  tools: { toolName: string; description?: string }[];
};

/** MCP transports the form offers. */
export type McpTransport = "stdio" | "sse" | "websocket" | "streamable-http";

/** The MCP server form's fields (JSON fields are raw text until saved). */
export type McpDraft = {
  name: string;
  transport: McpTransport;
  command: string;
  args: string;
  endpoint: string;
  headers: string;
  env: string;
  auth: string;
};

/** An empty MCP server form. */
export const EMPTY_MCP_DRAFT: McpDraft = {
  name: "",
  transport: "stdio",
  command: "",
  args: "",
  endpoint: "",
  headers: "",
  env: "",
  auth: "",
};

/** Badge text for a tool kind. */
export function kindLabel(k: ToolKind): string {
  if (k === "built-in") return "Built-in";
  if (k === "meta") return "Meta";
  if (k === "mcp") return "MCP";
  return "Custom";
}

/**
 * Kit Badge tone for a tool kind: built-in tools are cyan (tools and data),
 * meta tools violet (the agent's own harness), MCP and custom neutral.
 */
export function kindTone(k: ToolKind): "io" | "accent" | "neutral" {
  if (k === "built-in") return "io";
  if (k === "meta") return "accent";
  return "neutral";
}

/** When a tool was last used (ui-core `formatRelativeTime`: "5 minutes ago"), or "—" when never. */
export function relativeTime(ts: number | null, now: number = Date.now()): string {
  return ts == null ? "—" : formatRelativeTime(ts, now);
}

/** Catalog rows matching the search text (name, description or kind label). */
export function filterCatalog(catalog: CatalogEntry[], search: string): CatalogEntry[] {
  const q = search.trim().toLowerCase();
  if (!q) return catalog;
  return catalog.filter(
    (t) =>
      t.displayName.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      kindLabel(t.kind).toLowerCase().includes(q),
  );
}

/** Starting request JSON for a tool: first enum value, 0, false or "" per parameter. */
export function defaultRequestJson(params: readonly CatalogParam[]): string {
  const o: Record<string, unknown> = {};
  for (const p of params) {
    if (p.enum && p.enum.length > 0) o[p.name] = p.enum[0]!;
    else if (p.type === "number") o[p.name] = 0;
    else if (p.type === "boolean") o[p.name] = false;
    else o[p.name] = "";
  }
  return Object.keys(o).length > 0 ? JSON.stringify(o, null, 2) : "{}";
}

/** Form fields for editing a saved MCP server. */
export function mcpDraftFromRow(row: McpListRow): McpDraft {
  const c = row.config;
  const auth = (c as { auth?: unknown }).auth;
  return {
    name: typeof c.name === "string" ? c.name : row.name,
    transport: (c.transport as McpTransport) ?? "stdio",
    command: typeof c.command === "string" ? c.command : "",
    args: Array.isArray(c.args) ? (c.args as string[]).join(", ") : "",
    endpoint: typeof c.endpoint === "string" ? c.endpoint : "",
    headers: c.headers && typeof c.headers === "object" ? JSON.stringify(c.headers, null, 2) : "",
    env: c.env && typeof c.env === "object" ? JSON.stringify(c.env, null, 2) : "",
    auth: auth && typeof auth === "object" ? JSON.stringify(auth, null, 2) : "",
  };
}

/** Why the draft's JSON fields cannot be saved, or null when they can. */
export function mcpDraftJsonError(d: McpDraft): string | null {
  try {
    if (d.headers.trim()) JSON.parse(d.headers);
    if (d.env.trim()) JSON.parse(d.env);
    if (d.auth.trim()) JSON.parse(d.auth);
    if (d.transport === "stdio" && d.auth.trim()) {
      throw new Error("auth is only valid for http/sse/streamable-http transports");
    }
  } catch {
    return "Headers or env must be valid JSON objects";
  }
  return null;
}

/** POST/PATCH body for /api/mcp-servers. Throws on invalid JSON (check `mcpDraftJsonError` first). */
export function buildMcpPayload(d: McpDraft): Record<string, unknown> {
  const name = d.name.trim();
  const transport = d.transport;
  const body: Record<string, unknown> = { name, transport };
  if (transport === "stdio") {
    if (d.command.trim()) body.command = d.command.trim();
    const args = d.args.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
    if (args.length > 0) body.args = args;
  } else {
    if (d.endpoint.trim()) body.endpoint = d.endpoint.trim();
  }
  if (d.headers.trim()) {
    body.headers = JSON.parse(d.headers) as Record<string, string>;
  }
  if (d.env.trim()) {
    body.env = JSON.parse(d.env) as Record<string, string>;
  }
  if (d.auth.trim() && transport !== "stdio") {
    body.auth = JSON.parse(d.auth);
  }
  return body;
}

/** Result of validating pasted MCP import JSON: a preview line or an error. */
export type McpImportPreview = { preview: string; error: null } | { preview: null; error: string };

/** Describe pasted MCP JSON (single object, array, `{ servers }` or Cursor-style `{ mcpServers }`). */
export function previewMcpImport(rawInput: string): McpImportPreview {
  const raw = rawInput.trim();
  if (!raw) return { preview: null, error: "Paste JSON to validate/import." };
  try {
    const parsed = JSON.parse(raw) as unknown;
    const describeServer = (obj: Record<string, unknown>) => {
      const hasCommand = typeof obj.command === "string" || Array.isArray(obj.args);
      const hasUrl = typeof obj.url === "string" || typeof obj.endpoint === "string";
      return hasCommand ? "stdio" : hasUrl ? "url-based" : "unspecified";
    };
    if (Array.isArray(parsed)) {
      return { preview: `Detected array with ${parsed.length} server entries.`, error: null };
    }
    if (parsed && typeof parsed === "object") {
      const rec = parsed as Record<string, unknown>;
      if (Array.isArray(rec.servers)) {
        return { preview: `Detected { servers: [...] } with ${rec.servers.length} entries.`, error: null };
      }
      if (rec.mcpServers && typeof rec.mcpServers === "object" && !Array.isArray(rec.mcpServers)) {
        const entries = Object.entries(rec.mcpServers as Record<string, unknown>);
        const hints = entries
          .slice(0, 3)
          .map(([name, cfg]) => {
            const kind = cfg && typeof cfg === "object" ? describeServer(cfg as Record<string, unknown>) : "unspecified";
            return `${name} (${kind})`;
          })
          .join(", ");
        return { preview: `Detected Cursor-style mcpServers (${entries.length}): ${hints}${entries.length > 3 ? ", ..." : ""}`, error: null };
      }
      return { preview: "Detected single server object.", error: null };
    }
    return { preview: null, error: "JSON shape is unsupported. Use object/array." };
  } catch (e) {
    return { preview: null, error: `Invalid JSON: ${String(e)}` };
  }
}
