import type { Database } from "bun:sqlite";
import type { ToolDefinition, ToolParameter } from "@reactive-agents/tools";
import { builtinTools, metaToolDefinitions } from "@reactive-agents/tools";
import { listMcpServers, listCachedToolsForServers } from "../db/mcp-queries.js";
import { listLabCustomTools, type LabCustomToolRow } from "../db/lab-custom-tools-queries.js";
import { rollupToolUsageFromEvents } from "../db/tool-stats-queries.js";

/** Serializable parameter row for the Lab UI schema table. */
export type CortexCatalogParameter = {
  name: string;
  type: string;
  required: boolean;
  description: string;
  enum?: string[];
};

export type CortexToolCatalogEntry = {
  id: string;
  kind: "built-in" | "meta" | "mcp" | "custom";
  name: string;
  displayName: string;
  description: string;
  parameters: CortexCatalogParameter[];
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

function toCatalogParams(params: readonly ToolParameter[]): CortexCatalogParameter[] {
  return params.map((p) => ({
    name: p.name,
    type: p.enum && p.enum.length > 0 ? "enum" : p.type,
    required: p.required,
    description: p.description,
    ...(p.enum && p.enum.length > 0 ? { enum: [...p.enum] } : {}),
  }));
}

function metricsFor(db: Database, toolName: string): CortexToolCatalogEntry["metrics"] {
  const r = rollupToolUsageFromEvents(db, toolName);
  const successRatePct =
    r.callCount > 0 ? Math.round((r.successCount / r.callCount) * 1000) / 10 : null;
  return {
    callCount: r.callCount,
    successRatePct,
    avgDurationMs: r.avgDurationMs,
    lastUsedAt: r.lastUsedAt,
  };
}

function parseCustomParametersJson(raw: string): CortexCatalogParameter[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: CortexCatalogParameter[] = [];
    for (const x of parsed) {
      if (!x || typeof x !== "object") continue;
      const o = x as Record<string, unknown>;
      const name = typeof o.name === "string" ? o.name : "";
      if (!name) continue;
      const type = typeof o.type === "string" ? o.type : "string";
      const required = o.required === true;
      const description = typeof o.description === "string" ? o.description : "";
      const en = o.enum;
      const enumVals =
        Array.isArray(en) && en.every((v): v is string => typeof v === "string") ? [...en] : undefined;
      out.push({
        name,
        type,
        required,
        description,
        ...(enumVals && enumVals.length > 0 ? { enum: enumVals } : {}),
      });
    }
    return out;
  } catch {
    return [];
  }
}

function labCustomToDefinition(row: LabCustomToolRow): ToolDefinition | null {
  const parameters: ToolParameter[] = parseCustomParametersJson(row.parameters_json).map((p) => ({
    name: p.name,
    type:
      p.type === "number"
        ? "number"
        : p.type === "boolean"
          ? "boolean"
          : p.type === "object"
            ? "object"
            : p.type === "array"
              ? "array"
              : "string",
    description: p.description,
    required: p.required,
    ...(p.enum && p.enum.length > 0 ? { enum: p.enum } : {}),
  }));

  const name = row.name.trim();
  if (!name) return null;

  return {
    name,
    description: row.description || "Lab custom tool (echo)",
    parameters,
    riskLevel: "low",
    timeoutMs: 30_000,
    requiresApproval: false,
    source: "function",
  };
}

export function buildToolCatalog(db: Database): CortexToolCatalogEntry[] {
  const out: CortexToolCatalogEntry[] = [];

  for (const { definition } of builtinTools) {
    out.push({
      id: `bi:${definition.name}`,
      kind: "built-in",
      name: definition.name,
      displayName: definition.name,
      description: definition.description,
      parameters: toCatalogParams(definition.parameters),
      executable: true,
      metrics: metricsFor(db, definition.name),
    });
  }

  for (const definition of metaToolDefinitions) {
    out.push({
      id: `meta:${definition.name}`,
      kind: "meta",
      name: definition.name,
      displayName: definition.name,
      description: definition.description,
      parameters: toCatalogParams(definition.parameters),
      executable: false,
      executableHint:
        "Conductor / kernel meta-tool — enable via .withMetaTools() on an agent run; not executed in isolation here.",
      metrics: metricsFor(db, definition.name),
    });
  }

  const servers = listMcpServers(db);
  const ids = servers.map((s) => s.server_id);
  const cached = listCachedToolsForServers(db, ids);
  const serverNameById = new Map(servers.map((s) => [s.server_id, s.name]));

  for (const row of cached) {
    const registryName = row.tool_name;
    const serverName = serverNameById.get(row.server_id) ?? "mcp";
    out.push({
      id: `mcp:${row.server_id}:${encodeURIComponent(registryName)}`,
      kind: "mcp",
      name: registryName,
      displayName: registryName,
      description: row.description ?? `MCP tool on ${serverName}`,
      parameters: [],
      executable: true,
      executableHint:
        "Parameters appear after Refresh tools when the server exposes JSON Schema; you can still run with a raw JSON body.",
      serverId: row.server_id,
      serverName,
      metrics: metricsFor(db, registryName),
    });
  }

  for (const row of listLabCustomTools(db)) {
    const def = labCustomToDefinition(row);
    if (!def) continue;
    const disabled = row.disabled === 1;
    const entry: CortexToolCatalogEntry = {
      id: `lab:${row.tool_id}`,
      kind: "custom",
      name: def.name,
      displayName: def.name,
      description: def.description,
      parameters: parseCustomParametersJson(row.parameters_json),
      executable: !disabled,
      disabled,
      metrics: metricsFor(db, def.name),
    };
    if (disabled) {
      entry.executableHint = "Disabled — enable from the inspector.";
    }
    out.push(entry);
  }

  return out;
}

export type ParsedCatalogToolRef =
  | { tag: "builtin"; registryName: string }
  | { tag: "meta"; registryName: string }
  | { tag: "mcp"; serverId: string; registryName: string }
  | { tag: "custom"; toolId: string };

export function parseCatalogToolId(id: string): ParsedCatalogToolRef | null {
  if (id.startsWith("bi:")) {
    const registryName = id.slice(3);
    return registryName.length > 0 ? { tag: "builtin", registryName } : null;
  }
  if (id.startsWith("meta:")) {
    const registryName = id.slice(5);
    return registryName.length > 0 ? { tag: "meta", registryName } : null;
  }
  if (id.startsWith("lab:")) {
    const toolId = id.slice(4);
    return toolId.length > 0 ? { tag: "custom", toolId } : null;
  }
  if (id.startsWith("mcp:")) {
    const rest = id.slice(4);
    const i = rest.indexOf(":");
    if (i <= 0) return null;
    const serverId = rest.slice(0, i);
    const enc = rest.slice(i + 1);
    try {
      const registryName = decodeURIComponent(enc);
      return registryName.length > 0 ? { tag: "mcp", serverId, registryName } : null;
    } catch {
      return null;
    }
  }
  return null;
}

export { labCustomToDefinition };
