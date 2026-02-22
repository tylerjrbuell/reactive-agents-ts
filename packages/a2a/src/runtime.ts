import { Layer } from "effect";
import { A2AServer, createA2AServer, createA2AHttpServer } from "./server/index.js";
import { A2AClient, createA2AClient } from "./client/index.js";
import type { AgentCard } from "./types.js";
import type { ClientConfig } from "./client/a2a-client.js";

export const createA2AServerLayer = (agentCard: AgentCard, port?: number) =>
  Layer.mergeAll(
    createA2AServer(agentCard),
    createA2AHttpServer(port ?? 3000),
  );

export const createA2AClientLayer = (config: ClientConfig) => createA2AClient(config);

export const A2AServerLive = (agentCard: AgentCard) => createA2AServer(agentCard);
export const A2AClientLive = (config: ClientConfig) => createA2AClient(config);
