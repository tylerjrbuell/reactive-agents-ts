/**
 * Lab > Tools > Servers: the pure view rules behind the server list, the detail tabs and the add
 * menu. Components only wire these; each rule has a case in `mcp-servers-view.test.ts`.
 */
import { formatRelativeTime, type StatusTone } from "@reactive-agents/ui-core";
import { mcpServerStatus, type McpListRow, type McpStatus, type McpToolDetail } from "./tool-workshop.js";

/** The three ways to add a server (the add menu entries; Import JSON is a flow, not a mode toggle). */
export type AddMode = "quick" | "form" | "import";

/** Add menu entries in order, each with the words the menu shows. */
export const ADD_MODES: readonly { readonly id: AddMode; readonly label: string; readonly hint: string }[] = [
  { id: "quick", label: "Quick line", hint: "Paste a command or a URL" },
  { id: "form", label: "Form", hint: "Command, URL, headers and options" },
  { id: "import", label: "Import JSON", hint: "Paste an mcpServers block" },
];

/** Example the empty state and the quick line show. */
export const QUICK_ADD_EXAMPLE = "npx -y @modelcontextprotocol/server-filesystem .";

/** Tabs of the server detail pane. */
export type DetailTab = "tools" | "options" | "credentials";

/** Detail tabs in order. */
export const DETAIL_TABS: readonly { readonly id: DetailTab; readonly label: string }[] = [
  { id: "tools", label: "Tools" },
  { id: "options", label: "Options" },
  { id: "credentials", label: "Credentials" },
];

/** The status kit tone for a server's state. Never `running`: that tone means a run is live. */
export function statusTone(status: McpStatus): StatusTone {
  switch (status) {
    case "ok":
      return "done";
    case "error":
      return "failed";
    case "disabled":
      return "stopped";
    case "unknown":
      return "idle";
  }
}

/** One row of the master list. */
export interface ServerListRow {
  readonly serverId: string;
  readonly name: string;
  readonly status: McpStatus;
  readonly label: string;
  readonly tone: StatusTone;
  /** "3 tools" (or "No tools yet"). */
  readonly toolText: string;
  /** "checked 2 minutes ago" when a check ran, else nothing. */
  readonly checkedText: string | undefined;
  /** Disabled rows are dimmed and offer Enable. */
  readonly dimmed: boolean;
}

/** "3 tools", "1 tool", "No tools yet". */
export function toolCountText(n: number): string {
  return n === 0 ? "No tools yet" : `${n} tool${n === 1 ? "" : "s"}`;
}

/** The list row for a saved server: state chip, tool count and last check. */
export function serverListRow(row: McpListRow, now: number = Date.now()): ServerListRow {
  const s = mcpServerStatus(row, now);
  const checkedText = row.lastCheckedAt != null && row.enabled !== false ? `checked ${formatRelativeTime(row.lastCheckedAt, now)}` : undefined;
  return {
    serverId: row.serverId,
    name: row.name,
    status: s.status,
    label: s.label,
    tone: statusTone(s.status),
    toolText: toolCountText(row.tools.length),
    checkedText,
    dimmed: s.status === "disabled",
  };
}

/** Rows whose name or id contains the search text (case-insensitive); everything for blank text. */
export function filterServers(rows: readonly McpListRow[], search: string): McpListRow[] {
  const q = search.trim().toLowerCase();
  return q === "" ? [...rows] : rows.filter((r) => r.name.toLowerCase().includes(q) || r.serverId.toLowerCase().includes(q));
}

/** The failed-server card: the scrubbed last error, or nothing when the server is not in a failed state. */
export function failureOf(row: Pick<McpListRow, "enabled" | "lastStatus" | "lastError">): string | null {
  if (row.enabled === false || row.lastStatus !== "error") return null;
  const why = row.lastError?.trim();
  return why ? why : "The last connection attempt failed.";
}

/** Result of Test as the page shows it. */
export type TestReply = { readonly ok: true; readonly toolCount: number; readonly checkedAt: number } | { readonly ok: false; readonly error: string };

/** One inline line for a test result: the tool count, or the scrubbed error. */
export function testOutcomeText(r: TestReply): string {
  return r.ok ? `Connected: ${toolCountText(r.toolCount)}` : `Failed: ${r.error}`;
}

/** Which tools a server's `readOnly` option covers (`true` = all, a list = those names, `false`/absent = none). */
export function readOnlyOf(config: Record<string, unknown>): { readonly all: boolean; readonly names: readonly string[] } {
  const ro = config.readOnly;
  if (ro === true) return { all: true, names: [] };
  if (Array.isArray(ro)) return { all: false, names: ro.filter((n): n is string => typeof n === "string") };
  return { all: false, names: [] };
}

/** A cached tool name without its `server/` prefix. */
export function bareToolName(serverName: string, toolName: string): string {
  return toolName.startsWith(`${serverName}/`) ? toolName.slice(serverName.length + 1) : toolName;
}

/** Whether the server's `readOnly` option covers this tool (names match with or without the `server/` prefix). */
export function isReadOnlyTool(config: Record<string, unknown>, serverName: string, toolName: string): boolean {
  const { all, names } = readOnlyOf(config);
  if (all) return true;
  const bare = bareToolName(serverName, toolName);
  return names.some((n) => bareToolName(serverName, n) === bare);
}

/** Tools tab filter: all, tools the read-only option covers (`included`), the rest (`excluded`). */
export type ToolFilter = "all" | "included" | "excluded";

/** Filter options with their words. */
export const TOOL_FILTERS: readonly { readonly value: ToolFilter; readonly label: string }[] = [
  { value: "all", label: "All tools" },
  { value: "included", label: "Read-only" },
  { value: "excluded", label: "Not read-only" },
];

/** The tools the filter keeps (search text matches name or description). */
export function filterServerTools(
  tools: readonly McpToolDetail[],
  config: Record<string, unknown>,
  serverName: string,
  filter: ToolFilter,
  search = "",
): McpToolDetail[] {
  const q = search.trim().toLowerCase();
  return tools.filter((t) => {
    if (filter !== "all" && isReadOnlyTool(config, serverName, t.toolName) !== (filter === "included")) return false;
    return q === "" || t.toolName.toLowerCase().includes(q) || (t.description ?? "").toLowerCase().includes(q);
  });
}

/** One parameter line of a tool's input schema. */
export interface SchemaParam {
  readonly name: string;
  readonly type: string;
  readonly required: boolean;
  readonly description: string;
}

/** The parameters of a JSON input schema (`properties` + `required`); an empty list for anything else. */
export function schemaParams(schema: Record<string, unknown> | undefined): SchemaParam[] {
  if (schema === undefined) return [];
  const props = schema.properties;
  if (props === null || typeof props !== "object" || Array.isArray(props)) return [];
  const required: readonly unknown[] = Array.isArray(schema.required) ? schema.required : [];
  return Object.entries(props as Record<string, unknown>).map(([name, def]) => {
    const d = def !== null && typeof def === "object" ? (def as Record<string, unknown>) : {};
    const type = Array.isArray(d.type) ? d.type.join(" | ") : typeof d.type === "string" ? d.type : "any";
    return { name, type, required: required.includes(name), description: typeof d.description === "string" ? d.description : "" };
  });
}

/** Tooltip text for a tool's input schema: one line per parameter, or "No parameters". */
export function schemaTooltip(schema: Record<string, unknown> | undefined): string {
  const params = schemaParams(schema);
  if (params.length === 0) return "No parameters";
  return params.map((p) => `${p.name} (${p.type}${p.required ? ", required" : ""})${p.description ? `: ${p.description}` : ""}`).join("\n");
}
