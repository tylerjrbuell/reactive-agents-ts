/**
 * "Test a saved server": the one implementation behind `POST /api/mcp-servers/:id/test`, used by the
 * manual Test button and by the page's background status checks. It probes, always releases the
 * transport, records `last_status` / `last_error` / `last_checked_at` (never the tool cache), and is
 * single-flight per server so a double click, a second tab or a reload cannot start two probes of the
 * same server at once.
 */
import { getMcpServer, parseMcpConfig, recordMcpCheck } from "../db/mcp-queries.js";
import { cortexLog } from "../cortex-log.js";
import type { DiscoveredMcpTool } from "./mcp-discovery.js";
import { MCP_DISCOVERY_TIMEOUT_MS, probeMcpServer, type McpProbeDeps } from "./mcp-probe.js";

/** The database handle the query module takes (no second `bun:sqlite` import). */
type Db = Parameters<typeof getMcpServer>[0];

/** Shortest probe the caller may ask for. */
export const MIN_PROBE_TIMEOUT_MS = 1_000;

/** What a test answers. A failed probe is an answer, not an error. */
export type McpTestOutcome =
  | { readonly ok: true; readonly checkedAt: number; readonly tools: readonly DiscoveredMcpTool[] }
  | { readonly ok: false; readonly checkedAt: number; readonly error: string };

/** A requested time cap kept inside [1 s, the 10-minute manual cap]; absent = the manual cap. */
export const clampProbeTimeoutMs = (requested: number | undefined, manualCapMs: number = MCP_DISCOVERY_TIMEOUT_MS): number =>
  requested === undefined || !Number.isFinite(requested) ? manualCapMs : Math.min(manualCapMs, Math.max(MIN_PROBE_TIMEOUT_MS, Math.floor(requested)));

/** A tester over one database and one set of probe deps. `null` = no such server. */
export type McpServerTester = (serverId: string, opts?: { readonly timeoutMs?: number }) => Promise<McpTestOutcome | null>;

/** Build the tester; its in-flight map lives as long as the router that owns it. */
export function makeMcpServerTester(db: Db, deps: McpProbeDeps): McpServerTester {
  const inflight = new Map<string, Promise<McpTestOutcome>>();

  const run = async (serverId: string, timeoutMs: number | undefined, name: string): Promise<McpTestOutcome> => {
    const row = getMcpServer(db, serverId);
    if (!row) return { ok: false, checkedAt: Date.now(), error: "MCP server not found" };
    const cfg = parseMcpConfig(row);
    // Name and transport only: endpoints and command lines often carry tokens in the query string or args.
    cortexLog("info", "mcp", `test "${name}" transport=${cfg.transport}`);
    const cap = timeoutMs === undefined ? deps.timeoutMs : Math.min(deps.timeoutMs, clampProbeTimeoutMs(timeoutMs, deps.timeoutMs));
    const result = await probeMcpServer(cfg, { ...deps, timeoutMs: cap }, { alwaysCleanup: true });
    const checkedAt = Date.now();
    if (!result.ok) {
      recordMcpCheck(db, serverId, { status: "error", error: result.error }, checkedAt);
      cortexLog("warn", "mcp", `test "${name}" failed`);
      return { ok: false, checkedAt, error: result.error };
    }
    recordMcpCheck(db, serverId, { status: "ok" }, checkedAt);
    return { ok: true, checkedAt, tools: result.tools };
  };

  return async (serverId, opts = {}) => {
    const row = getMcpServer(db, serverId);
    if (!row) return null;
    const running = inflight.get(serverId);
    if (running) return running;
    const started = run(serverId, opts.timeoutMs, row.name).finally(() => inflight.delete(serverId));
    inflight.set(serverId, started);
    return started;
  };
}
