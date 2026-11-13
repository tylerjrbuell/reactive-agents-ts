import type { AgentCard, A2ATask, SendMessageParams, TaskQueryParams, TaskCancelParams } from "../types.js";
import {
  A2AError,
  TransportError,
  DiscoveryError,
  RequestTimeoutError,
  ResponseTooLargeError,
  EgressDeniedError,
} from "../errors.js";
import { Effect, Context, Layer } from "effect";
import { assertPublicUrl, fetchPinned } from "@reactive-agents/runtime-shim";
import { agentEgressGuard, type AgentEgressConfig } from "./discovery.js";

/** Errors a client RPC can fail with. */
export type ClientRequestError =
  | A2AError
  | TransportError
  | RequestTimeoutError
  | ResponseTooLargeError
  | EgressDeniedError;

export class A2AClient extends Context.Tag("A2AClient")<
  A2AClient,
  {
    readonly sendMessage: (params: SendMessageParams) => Effect.Effect<A2ATask, ClientRequestError>;
    readonly getTask: (params: TaskQueryParams) => Effect.Effect<A2ATask, ClientRequestError>;
    readonly cancelTask: (params: TaskCancelParams) => Effect.Effect<A2ATask, ClientRequestError>;
    readonly getAgentCard: (url: string) => Effect.Effect<AgentCard, DiscoveryError | TransportError>;
  }
>() {}

export interface ClientConfig {
  baseUrl: string;
  /** Egress policy for `getAgentCard` and RPCs (metadata/link-local always blocked; `strictEgress` also blocks private). */
  egress?: AgentEgressConfig;
  /** Per-request time budget in ms (connect + headers + body). Default 30000. */
  timeoutMs?: number;
  /** Max response body bytes; the streamed read aborts past it. Default 5 MiB. */
  maxResponseBytes?: number;
  /**
   * Explicit private-network opt in/out for `sendMessage`/`getTask`/`cancelTask`. Overrides
   * `egress` / `RA_AGENT_STRICT_EGRESS`. Cloud-metadata and link-local are blocked either way.
   */
  allowPrivateNetwork?: boolean;
  auth?: {
    type: "bearer" | "apiKey";
    token?: string;
    apiKey?: string;
  };
}

const JSONRPC_VERSION = "2.0";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

const prop = (e: unknown, key: "_tag" | "name" | "code" | "message"): unknown =>
  typeof e === "object" && e !== null && key in e ? (e as Record<string, unknown>)[key] : undefined;

const isAbort = (e: unknown): boolean => prop(e, "name") === "AbortError" || prop(e, "code") === "ABORT_ERR";

/** Stream-count the body, aborting once it passes `maxBytes` (Content-Length is only a fast path). */
const readBounded = async (response: Response, maxBytes: number, url: string): Promise<string> => {
  const tooLarge = () =>
    new ResponseTooLargeError({ message: `response body exceeded ${maxBytes} bytes`, url, maxBytes });
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel();
    throw tooLarge();
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
};

export const createA2AClient = (config: ClientConfig) =>
  Layer.effect(
    A2AClient,
    Effect.gen(function* () {
      const url = config.baseUrl;
      const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const maxBytes = config.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
      // Explicit allowPrivateNetwork wins; otherwise the shared agent egress policy.
      const allowPrivate = config.allowPrivateNetwork ?? agentEgressGuard(config.egress).allowPrivate;

      const makeRequest = <T>(method: string, params?: unknown): Effect.Effect<T, ClientRequestError> =>
        Effect.suspend(() => {
        const timedOutRef = { value: false };
        return Effect.tryPromise({
          try: async () => {
            const controller = new AbortController();
            let timer: ReturnType<typeof setTimeout> | undefined;
            // Raced against the work: the runtime transport does not reliably honour the abort
            // signal before response headers arrive, so the deadline must reject on its own.
            const deadline = new Promise<never>((_, reject) => {
              timer = setTimeout(() => {
                timedOutRef.value = true;
                controller.abort();
                reject(new DOMException("deadline", "AbortError"));
              }, timeoutMs);
            });
            const work = async (): Promise<T> => {
              // fetchPinned validates DNS once and connects to the validated address (no rebinding).
              // "manual": a redirect is refused, never followed (it would forward credentials).
              const response = await fetchPinned(
                url,
                {
                  method: "POST",
                  signal: controller.signal,
                  headers: {
                    "Content-Type": "application/json",
                    ...(config.auth?.type === "bearer" && { Authorization: `Bearer ${config.auth.token}` }),
                    ...(config.auth?.type === "apiKey" && { "X-API-Key": config.auth.apiKey ?? "" }),
                  },
                  body: JSON.stringify({ jsonrpc: JSONRPC_VERSION, method, params, id: crypto.randomUUID() }),
                },
                { allowPrivate, redirect: "manual" },
              );
              if (response.status >= 300 && response.status < 400) {
                await response.body?.cancel();
                throw new EgressDeniedError({ message: `redirect refused (HTTP ${response.status})`, url });
              }
              const text = await readBounded(response, maxBytes, url);
              const data = JSON.parse(text) as { result?: T; error?: { code: number; message: string } };
              if (data.error) {
                throw new A2AError({ code: String(data.error.code), message: data.error.message });
              }
              return data.result as T;
            };
            const pending = work();
            pending.catch(() => undefined); // the loser of the race must not surface as unhandled
            try {
              return await Promise.race([pending, deadline]);
            } finally {
              clearTimeout(timer);
            }
          },
          catch: (e): ClientRequestError => {
            // Pinned legacy behaviour: a server-side JSON-RPC error surfaces as TransportError
            // (a2a-client.test.ts "propagate server-side JSON-RPC errors"); A2AError is not narrowed here.
            if (prop(e, "_tag") === "ResponseTooLargeError" || prop(e, "_tag") === "EgressDeniedError") {
              return e as ResponseTooLargeError | EgressDeniedError;
            }
            // Only our timer aborts the controller, so an abort-shaped error means timeout.
            if (isAbort(e) || timedOutRef.value) {
              return new RequestTimeoutError({ message: `request timed out after ${timeoutMs}ms`, url, timeoutMs });
            }
            if (prop(e, "_tag") === "PublicUrlError") {
              return new EgressDeniedError({ message: String(prop(e, "message") ?? e), url });
            }
            return new TransportError({ message: String(e), url });
          },
        });
        });

      return {
        sendMessage: (params) => makeRequest<A2ATask>("message/send", params),
        getTask: (params) => makeRequest<A2ATask>("tasks/get", params),
        cancelTask: (params) => makeRequest<A2ATask>("tasks/cancel", params),

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
