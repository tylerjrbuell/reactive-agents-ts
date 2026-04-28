/**
 * @reactive-agents/react — React hooks for agent UI integration.
 *
 * @unstable All exports unstable. Zero in-repo consumers (Cortex UI uses its
 * own framework), zero tests, SSE contract hand-coupled to runtime via `_tag`
 * strings — runtime change breaks silently. May change in v0.10.x without
 * notice. See AUDIT-overhaul-2026.md §11 #42.
 *
 * Server setup (Next.js App Router example):
 * ```typescript
 * // app/api/agent/route.ts
 * import { ReactiveAgents, AgentStream } from "reactive-agents";
 * export async function POST(req: Request) {
 *   const { prompt } = await req.json();
 *   const agent = await ReactiveAgents.create().withProvider("anthropic").withTools().build();
 *   return AgentStream.toSSE(agent.runStream(prompt));
 * }
 * ```
 *
 * Client usage:
 * ```typescript
 * import { useAgentStream } from "@reactive-agents/react";
 * function Chat() {
 *   const { text, status, error, run } = useAgentStream("/api/agent");
 *   return (
 *     <div>
 *       <button onClick={() => run("Explain quantum entanglement")}>Ask</button>
 *       <p>{text}</p>
 *       {status === "streaming" && <span>Thinking...</span>}
 *     </div>
 *   );
 * }
 * ```
 */

export type { AgentStreamEvent, AgentHookState, UseAgentStreamReturn, UseAgentReturn } from "./types.js";
export { useAgentStream } from "./use-agent-stream.js";
export { useAgent } from "./use-agent.js";
