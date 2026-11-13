import type { AgentCard, A2AMessage, A2ATask, SendMessageParams, TaskQueryParams, TaskCancelParams, JsonRpcRequest } from "../types.js";
import { A2AError, TransportError, DiscoveryError } from "../errors.js";
import { Effect, Context, Layer, Ref } from "effect";
import { assertPublicUrl } from "@reactive-agents/runtime-shim";
import { agentEgressGuard, type AgentEgressConfig } from "./discovery.js";

export class A2AClient extends Context.Tag("A2AClient")<
  A2AClient,
  {
    readonly sendMessage: (params: SendMessageParams) => Effect.Effect<A2ATask, A2AError | TransportError>;
    readonly getTask: (params: TaskQueryParams) => Effect.Effect<A2ATask, A2AError | TransportError>;
    readonly cancelTask: (params: TaskCancelParams) => Effect.Effect<A2ATask, A2AError | TransportError>;
    readonly getAgentCard: (url: string) => Effect.Effect<AgentCard, DiscoveryError | TransportError>;
  }
>() {}

export interface ClientConfig {
  baseUrl: string;
  /** Egress policy for `getAgentCard` (metadata/link-local always blocked; `strictEgress` also blocks private). */
  egress?: AgentEgressConfig;
  auth?: {
    type: "bearer" | "apiKey";
    token?: string;
    apiKey?: string;
  };
}

const JSONRPC_VERSION = "2.0";

export const createA2AClient = (config: ClientConfig) =>
  Layer.effect(
    A2AClient,
    Effect.gen(function* () {
      const makeRequest = <T>(method: string, params?: unknown): Effect.Effect<T, TransportError> =>
        Effect.tryPromise({
          try: async () => {
            const response = await fetch(`${config.baseUrl}`, {
              method: "POST",
              // A redirect would forward X-API-Key (and Bearer on same-origin hops) to a host the
              // caller never configured; refuse it.
              redirect: "error",
              headers: {
                "Content-Type": "application/json",
                ...(config.auth?.type === "bearer" && { Authorization: `Bearer ${config.auth.token}` }),
                ...(config.auth?.type === "apiKey" && { "X-API-Key": config.auth.apiKey }),
              },
              body: JSON.stringify({
                jsonrpc: JSONRPC_VERSION,
                method,
                params,
                id: crypto.randomUUID(),
              }),
            });
            const data = await response.json() as { result?: T; error?: { code: number; message: string } };
            if (data.error) {
              throw new A2AError({ code: String(data.error.code), message: data.error.message });
            }
            return data.result as T;
          },
          catch: (e) =>
            new TransportError({
              message: String(e),
              url: config.baseUrl,
            }),
        });

      return {
        sendMessage: (params) =>
          makeRequest<A2ATask>("message/send", params).pipe(
            Effect.mapError((e) => e as A2AError | TransportError),
          ),

        getTask: (params) =>
          makeRequest<A2ATask>("tasks/get", params).pipe(
            Effect.mapError((e) => e as A2AError | TransportError),
          ),

        cancelTask: (params) =>
          makeRequest<A2ATask>("tasks/cancel", params).pipe(
            Effect.mapError((e) => e as A2AError | TransportError),
          ),

        getAgentCard: (url) =>
          Effect.tryPromise({
            try: async () => {
              const cardUrl = `${url.replace(/\/$/, "")}/agent/card`;
              await assertPublicUrl(cardUrl, agentEgressGuard(config.egress));
              const response = await fetch(cardUrl, { redirect: "error" });
              const data = await response.json();
              return data as AgentCard;
            },
            catch: (e) => new DiscoveryError({ message: String(e), url }),
          }),
      };
    }),
  );
