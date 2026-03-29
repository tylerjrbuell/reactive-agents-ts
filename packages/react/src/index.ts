/**
 * @reactive-agents/react
 *
 * React hooks for consuming Reactive Agents from client-side components.
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
