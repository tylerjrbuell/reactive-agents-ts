/**
 * Probe a saved MCP server: connect, list its tools, disconnect. Used by "Test connection"
 * (`POST /api/mcp-servers/:id/test`, which writes nothing to the tool cache) and by "Refresh tools"
 * (which stores what the probe found). Failures come back as a value, never a throw, with a message
 * that has the server's own credentials scrubbed so it is safe to store and show.
 */
import { cleanupMcpTransport } from "@reactive-agents/tools";
import type { MCPServerConfig } from "@reactive-agents/runtime";
import { discoverMcpTools, type DiscoveredMcpTool } from "./mcp-discovery.js";
import { sanitizedCause } from "./channel-hub-failure.js";
import { MCP_SECRET_MASK } from "./mcp-secrets.js";

/** 10-minute hard cap: covers the worst-case first `docker pull` of a large image. */
export const MCP_DISCOVERY_TIMEOUT_MS = 600_000;

/** The pieces a probe uses; tests inject fakes. */
export interface McpProbeDeps {
  readonly discover: (cfg: MCPServerConfig) => Promise<DiscoveredMcpTool[]>;
  readonly cleanup: (serverName: string) => void;
  readonly timeoutMs: number;
}

export const defaultMcpProbeDeps: McpProbeDeps = {
  discover: discoverMcpTools,
  cleanup: cleanupMcpTransport,
  timeoutMs: MCP_DISCOVERY_TIMEOUT_MS,
};

export type McpProbeResult =
  | { readonly ok: true; readonly tools: DiscoveredMcpTool[] }
  | { readonly ok: false; readonly error: string };

/** Every credential value the config holds (env, headers, OAuth secrets). */
const secretValuesOf = (cfg: MCPServerConfig): string[] => {
  const out = [...Object.values(cfg.env ?? {}), ...Object.values(cfg.headers ?? {})];
  const auth = cfg.auth;
  if (auth !== undefined) {
    if ("clientSecret" in auth && typeof auth.clientSecret === "string") out.push(auth.clientSecret);
    if ("privateKey" in auth && typeof auth.privateKey === "string") out.push(auth.privateKey);
  }
  return out.filter((v) => v.length >= 4 && v !== MCP_SECRET_MASK);
};

/** A one-line failure message with the server's credentials replaced by the mask. */
export const scrubMcpError = (err: unknown, cfg: MCPServerConfig): string =>
  secretValuesOf(cfg).reduce((text, secret) => text.split(secret).join(MCP_SECRET_MASK), sanitizedCause(err));

/**
 * Run discovery against `cfg` within the time cap. On expiry the transport is killed so the
 * subprocess does not leak. With `alwaysCleanup` the transport is also released afterwards
 * whatever happened (a test must leave nothing running).
 */
export async function probeMcpServer(
  cfg: MCPServerConfig,
  deps: McpProbeDeps = defaultMcpProbeDeps,
  opts: { readonly alwaysCleanup?: boolean } = {},
): Promise<McpProbeResult> {
  const discovery = deps.discover(cfg);
  // Prevent an unhandled rejection if the timeout settles first.
  discovery.catch(() => {});
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timeoutId = setTimeout(() => {
      deps.cleanup(cfg.name);
      resolve("timeout");
    }, deps.timeoutMs);
  });
  try {
    const settled = await Promise.race([discovery, timeout]);
    if (settled === "timeout") {
      return { ok: false, error: `MCP tool discovery timed out after ${deps.timeoutMs / 60_000} minutes` };
    }
    return { ok: true, tools: settled };
  } catch (e) {
    return { ok: false, error: scrubMcpError(e, cfg) };
  } finally {
    clearTimeout(timeoutId);
    if (opts.alwaysCleanup === true) deps.cleanup(cfg.name);
  }
}
