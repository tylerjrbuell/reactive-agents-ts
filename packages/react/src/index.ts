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
export { useAgentStream } from "./hooks/use-agent-stream.js";
export { useAgent } from "./hooks/use-agent.js";

export { useRun, type UseRunOptions, type UseRunReturn } from "./hooks/use-run.js";
export { useResumableRun, type UseResumableRunOptions } from "./hooks/use-resumable-run.js";
export { useInteractions, type UseInteractionsOptions, type UseInteractionsReturn } from "./hooks/use-interactions.js";
export { AgentPrompt, type AgentPromptProps } from "./components/AgentPrompt.js";
export { ChoiceCard, type ChoiceCardProps } from "./components/ChoiceCard.js";
export { ApprovalGate, type ApprovalGateProps } from "./components/ApprovalGate.js";
export {
  useTaskInbox,
  type UseTaskInboxOptions,
  type UseTaskInboxReturn,
  type InboxRun,
} from "./hooks/use-task-inbox.js";
export { TaskInbox, type TaskInboxProps } from "./components/TaskInbox.js";
export { useRunCost } from "./hooks/use-run-cost.js";
export { useRunSteps, type StepEntry } from "./hooks/use-run-steps.js";
export { CostMeter, type CostMeterProps } from "./components/CostMeter.js";
export { StepTimeline, type StepTimelineProps } from "./components/StepTimeline.js";
export {
  AgentSurface,
  type AgentSurfaceProps,
  type UiNode,
  type ComponentRegistry,
  uiTreeSchema,
} from "./components/render/AgentSurface.js";
export { AgentDevtools, type AgentDevtoolsProps } from "./components/AgentDevtools.js";
// Re-export ui-core protocol + state types for consumers.
export type { RunState, UiStreamEvent, UiRunStatus, PendingInteractionWire } from "@reactive-agents/ui-core";
