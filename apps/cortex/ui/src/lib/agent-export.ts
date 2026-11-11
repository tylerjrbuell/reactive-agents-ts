import { CORTEX_SERVER_URL } from "$lib/constants.js";
import { cortexRunsPostBody } from "$lib/cortex-runs-post-body.js";
import { hydrateAgentConfig, type AgentConfig } from "$lib/types/agent-config.js";

/** A setting the agent runs with in Cortex that the exported code does not contain. */
export interface CortexOnlySetting {
  readonly setting: string;
  /** The builder call Cortex applies for it. */
  readonly call: string;
  readonly detail?: string;
}

/** `POST /api/agent-config/source` result. */
export interface AgentSource {
  /** TypeScript from the framework's `agentConfigToSource`. */
  readonly source: string;
  /** Cortex overlay settings the code leaves out. */
  readonly notInCode: readonly CortexOnlySetting[];
}

/** Outcome of {@link fetchAgentSource}. */
export type AgentSourceResult = { readonly ok: true; readonly value: AgentSource } | { readonly ok: false; readonly error: string };

/**
 * Body for `POST /api/agent-config/source`: the desk-run body (`cortexRunsPostBody`)
 * without the prompt, named `name` (else the config's own agent name). Stored or
 * legacy configs are hydrated first, so a sparse saved agent never crashes.
 */
export function agentSourceBody(config: AgentConfig, name: string): Record<string, unknown> {
  const full = hydrateAgentConfig({ ...config });
  const { prompt: _prompt, ...body } = cortexRunsPostBody("", full);
  const agentName = name.trim() || full.agentName.trim();
  return agentName ? { ...body, agentName } : body;
}

/**
 * Ask the server for the agent's TypeScript: the framework's own emitter over the
 * AgentConfig Cortex builds from, plus the Cortex-only settings it leaves out.
 */
export async function fetchAgentSource(
  config: AgentConfig,
  name: string,
  fetchImpl: (url: string, init: RequestInit) => Promise<Response> = (u, i) => fetch(u, i),
): Promise<AgentSourceResult> {
  try {
    const res = await fetchImpl(`${CORTEX_SERVER_URL}/api/agent-config/source`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(agentSourceBody(config, name)),
    });
    const json: unknown = await res.json();
    if (!res.ok || typeof json !== "object" || json === null || typeof (json as { source?: unknown }).source !== "string") {
      const error = typeof json === "object" && json !== null ? (json as { error?: unknown }).error : undefined;
      return { ok: false, error: typeof error === "string" ? error : `Export failed (${res.status})` };
    }
    const value = json as AgentSource;
    return { ok: true, value: { source: value.source, notInCode: Array.isArray(value.notInCode) ? value.notInCode : [] } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Download file name for an export: `research-bot.ts`, `agent.json`. */
export function agentExportFilename(name: string, ext: "ts" | "json"): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "agent";
  return `${slug}.${ext}`;
}

/** Serialize the agent as a portable JSON config envelope (read by the Lab's Import). */
export function generateAgentJson(config: AgentConfig, name: string): string {
  return JSON.stringify({ name, config }, null, 2);
}
