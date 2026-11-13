export * from "./types.js";
export * from "./errors.js";
export { A2AServer, createA2AServer } from "./server/a2a-server.js";
export { A2AHttpServer, createA2AHttpServer, type A2AHttpServerOptions } from "./server/http-server.js";
export { createTaskHandler, type TaskExecutor } from "./server/task-handler.js";
export { formatSSEEvent, type StreamEvent } from "./server/streaming.js";
export { A2AClient, createA2AClient } from "./client/a2a-client.js";
export type { ClientConfig, ClientRequestError } from "./client/a2a-client.js";
export {
  discoverAgent,
  discoverMultipleAgents,
  agentEgressGuard,
  type AgentEgressConfig,
} from "./client/discovery.js";
export { matchCapabilities, findBestAgent, type MatchResult } from "./client/capability-matcher.js";
export { generateAgentCard, toolsToSkills, type AgentCardGeneratorConfig } from "./agent-card.js";
export { agentStrictEgressEnabled } from "./flags.js";
export { createA2AClientLayer, A2AClientLive } from "./runtime.js";
