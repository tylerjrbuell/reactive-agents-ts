/**
 * Lab Tools tab (ToolWorkshop): catalog types and the pure rules behind the
 * catalog list, the test runner's default arguments and the MCP server form.
 */
import { formatRelativeTime } from "@reactive-agents/ui-core";

/** Where a catalog tool comes from. */
export type ToolKind = "built-in" | "meta" | "mcp" | "custom";

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
  /** False when switched off: agents never start it. Absent on an older server build (treated as on). */
  enabled?: boolean;
  /** Outcome of the last test or tool refresh; null / absent = never checked. */
  lastStatus?: "ok" | "error" | null;
  lastError?: string | null;
  lastCheckedAt?: number | null;
};

/** One cached tool of a server with its JSON input schema (GET /api/mcp-servers/:id/tools). */
export type McpToolDetail = { toolName: string; description?: string; inputSchema?: Record<string, unknown> };

/** How a saved server reads in the list. */
export type McpStatus = "ok" | "error" | "disabled" | "unknown";

/** What to show for a server's state: the kind, a short label and (when there is one) the reason or age. */
export function mcpServerStatus(
  row: Pick<McpListRow, "enabled" | "lastStatus" | "lastError" | "lastCheckedAt">,
  now: number = Date.now(),
): { status: McpStatus; label: string; detail?: string } {
  if (row.enabled === false) return { status: "disabled", label: "Disabled", detail: "Agents will not start this server" };
  const checked = row.lastCheckedAt != null ? `checked ${formatRelativeTime(row.lastCheckedAt, now)}` : undefined;
  if (row.lastStatus === "ok") return { status: "ok", label: "Connected", ...(checked ? { detail: checked } : {}) };
  if (row.lastStatus === "error") {
    const why = row.lastError?.trim();
    const detail = [why, checked].filter(Boolean).join(" · ");
    return { status: "error", label: "Failed", ...(detail ? { detail } : {}) };
  }
  return { status: "unknown", label: "Not checked" };
}

/** One editable credential line. A `stored` row shows a mask and keeps its value unless `value` is typed. */
export type CredentialRow = { key: string; value: string; stored: boolean };

/** Rows for the keys a server already holds (values are write-only: never read back, so `value` starts empty). */
export function credentialRowsOf(record: Record<string, unknown> | undefined): CredentialRow[] {
  return Object.keys(record ?? {}).map((key) => ({ key, value: "", stored: true }));
}

/** One credential record's edit as the secrets route takes it. */
export type CredentialEdit = { set?: Record<string, string>; remove?: string[] };

/**
 * What changed between the stored keys and the rows on screen: typed values (new or replacing) go to
 * `set`, stored keys whose row is gone go to `remove`. A stored row left blank keeps its value; a new
 * row with no key or no value is ignored. Null when nothing changed.
 */
export function credentialEdit(storedKeys: readonly string[], rows: readonly CredentialRow[]): CredentialEdit | null {
  const set: Record<string, string> = {};
  const present = new Set<string>();
  for (const row of rows) {
    const key = row.key.trim();
    if (key === "") continue;
    present.add(key);
    if (row.value !== "") set[key] = row.value;
  }
  const remove = storedKeys.filter((k) => !present.has(k));
  if (Object.keys(set).length === 0 && remove.length === 0) return null;
  return { ...(Object.keys(set).length > 0 ? { set } : {}), ...(remove.length > 0 ? { remove } : {}) };
}

/** Body for PUT /api/mcp-servers/:id/secrets, or null when neither record changed. */
export function secretsPayload(edits: { env: CredentialEdit | null; headers: CredentialEdit | null }): { env?: CredentialEdit; headers?: CredentialEdit } | null {
  if (edits.env === null && edits.headers === null) return null;
  return { ...(edits.env ? { env: edits.env } : {}), ...(edits.headers ? { headers: edits.headers } : {}) };
}

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
  /** Read-only promise: `off` = not declared, `all` = every tool, `tools` = the names in `readOnlyTools`. */
  readOnlyMode: "off" | "all" | "tools";
  /** Tool names (no `server/` prefix), comma or newline separated; used when `readOnlyMode` is `tools`. */
  readOnlyTools: string;
  /** Honor the server's own `readOnlyHint` annotations. */
  trustAnnotations: boolean;
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
  readOnlyMode: "off",
  readOnlyTools: "",
  trustAnnotations: false,
};

const splitNames = (s: string): string[] => s.split(/[\n,]/).map((n) => n.trim()).filter(Boolean);

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
    readOnlyMode: c.readOnly === true ? "all" : Array.isArray(c.readOnly) && c.readOnly.length > 0 ? "tools" : "off",
    readOnlyTools: Array.isArray(c.readOnly) ? (c.readOnly as string[]).join(", ") : "",
    trustAnnotations: c.trustAnnotations === true,
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
  if (d.readOnlyMode === "all") body.readOnly = true;
  else if (d.readOnlyMode === "tools") {
    const names = splitNames(d.readOnlyTools);
    if (names.length > 0) body.readOnly = names;
  }
  if (d.trustAnnotations) body.trustAnnotations = true;
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
