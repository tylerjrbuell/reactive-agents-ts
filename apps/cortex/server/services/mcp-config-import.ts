import type { MCPServerConfig } from "@reactive-agents/runtime";

const TRANSPORTS = new Set(["stdio", "sse", "websocket", "streamable-http"]);

/**
 * When `transport` is omitted and only an HTTP(S) endpoint is given, pick the MCP wire mode.
 * Paths ending in `/mcp` are usually MCP streamable HTTP (POST + optional SSE in body), e.g. Context7.
 * Other URLs default to legacy SSE (GET event stream + POST JSON-RPC on the same base), e.g. `/sse`.
 */
export function inferHttpMcpTransport(endpoint: string): "sse" | "streamable-http" {
  try {
    const trimmed = endpoint.trim();
    const base = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`;
    const u = new URL(base);
    const p = (u.pathname.replace(/\/+$/, "") || "/").toLowerCase();
    if (p === "/mcp" || p.endsWith("/mcp")) return "streamable-http";
    return "sse";
  } catch {
    return "sse";
  }
}

/**
 * Parse request body into a single {@link MCPServerConfig} (shared with POST /api/mcp-servers).
 * Accepts `url` as an alias for `endpoint` and infers `transport` when omitted.
 */
export function parseConfigBody(body: Record<string, unknown>): MCPServerConfig | null {
  const b = { ...body };
  if (typeof b.url === "string" && b.url.trim()) {
    const ep = typeof b.endpoint === "string" ? b.endpoint.trim() : "";
    if (!ep) b.endpoint = b.url.trim();
    delete b.url;
  }
  if (typeof b.transport !== "string" || !TRANSPORTS.has(b.transport)) {
    const endpoint = typeof b.endpoint === "string" ? b.endpoint.trim() : "";
    const hasCmd = typeof b.command === "string" && b.command.trim().length > 0;
    const hasArgs = Array.isArray(b.args) && b.args.length > 0;
    if (endpoint) b.transport = inferHttpMcpTransport(endpoint);
    else if (hasCmd || hasArgs) b.transport = "stdio";
    else return null;
  }
  const name = typeof b.name === "string" ? b.name.trim() : "";
  const transport = b.transport as string;
  if (!name || !TRANSPORTS.has(transport)) return null;
  const cfg: MCPServerConfig = {
    name,
    transport: transport as MCPServerConfig["transport"],
  };
  if (typeof b.command === "string" && b.command.trim()) cfg.command = b.command.trim();
  if (Array.isArray(b.args)) {
    const args = b.args.filter((a): a is string => typeof a === "string");
    if (args.length > 0) cfg.args = args;
  }
  if (typeof b.cwd === "string" && b.cwd.trim()) cfg.cwd = b.cwd.trim();
  if (b.env && typeof b.env === "object" && !Array.isArray(b.env)) {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(b.env as Record<string, unknown>)) {
      if (typeof v === "string") env[k] = v;
    }
    if (Object.keys(env).length > 0) cfg.env = env;
  }
  if (typeof b.endpoint === "string" && b.endpoint.trim()) cfg.endpoint = b.endpoint.trim();
  if (b.headers && typeof b.headers === "object" && !Array.isArray(b.headers)) {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(b.headers as Record<string, unknown>)) {
      if (typeof v === "string") headers[k] = v;
    }
    if (Object.keys(headers).length > 0) cfg.headers = headers;
  }
  return cfg;
}

function normalizeOne(raw: Record<string, unknown>, nameFromKey?: string): MCPServerConfig | null {
  const merged = { ...raw };
  const innerName = typeof merged.name === "string" ? merged.name.trim() : "";
  if (!innerName && nameFromKey) merged.name = nameFromKey;
  return parseConfigBody(merged);
}

/**
 * Expand pasted JSON into zero or more configs:
 * - A single config object
 * - An array of config objects
 * - `{ "servers": [...] }`
 * - Cursor-style `{ "mcpServers": { "my-server": { command, args, ... } } }`
 */
export function expandMcpConfigsFromJson(parsed: unknown): MCPServerConfig[] {
  const out: MCPServerConfig[] = [];
  if (parsed == null) return out;

  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const c = normalizeOne(item as Record<string, unknown>);
        if (c) out.push(c);
      }
    }
    return out;
  }

  if (typeof parsed !== "object") return out;
  const o = parsed as Record<string, unknown>;

  if (Array.isArray(o.servers)) {
    return expandMcpConfigsFromJson(o.servers);
  }

  const mcp = o.mcpServers;
  if (mcp && typeof mcp === "object" && !Array.isArray(mcp)) {
    for (const [key, v] of Object.entries(mcp as Record<string, unknown>)) {
      if (!v || typeof v !== "object" || Array.isArray(v)) continue;
      const c = normalizeOne(v as Record<string, unknown>, key);
      if (c) out.push(c);
    }
    return out;
  }

  const c = normalizeOne(o);
  if (c) out.push(c);
  return out;
}
