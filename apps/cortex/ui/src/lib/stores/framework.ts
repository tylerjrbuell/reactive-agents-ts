/**
 * Built-in Reactive Agents Svelte stores (`@reactive-agents/svelte`).
 *
 * - **`createAgent` / `createAgentStream`** — call your agent over HTTP (POST + optional SSE `data:` lines).
 *   Use relative paths so Vite’s dev proxy can forward to the Cortex server or any agent API you mount.
 *
 * - **`createAgentStore`** (see `./agent-store.js`) — Cortex **desk**: multi-agent map, live `CortexLiveMessage`
 *   from `/ws/live/...`, and hydration from `GET /api/runs`. Compose both: desk for observability, framework
 *   stores for “run a prompt” flows (Workshop / Quick Run).
 */
import { createAgent, createAgentStream } from "@reactive-agents/svelte";

export { createAgent, createAgentStream };
export type { AgentState, AgentStreamState, AgentStreamEvent } from "@reactive-agents/svelte";

/**
 * Non-streaming agent run against a POST JSON endpoint (same contract as `createAgent`).
 * Default path is a placeholder; point at your deployed agent route or a future Cortex proxy.
 */
export function createCortexAgentRun(
  postPath = "/api/agent/run",
  requestInit?: Omit<RequestInit, "method" | "body">,
) {
  return createAgent(postPath, requestInit);
}

/**
 * Token streaming run (SSE-style `data:` JSON lines). Default path is a placeholder for your stream endpoint.
 */
export function createCortexAgentStreamRun(
  streamPath = "/api/agent/stream",
  requestInit?: Omit<RequestInit, "method" | "body" | "signal">,
) {
  return createAgentStream(streamPath, requestInit);
}
