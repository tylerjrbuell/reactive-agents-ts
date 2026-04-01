import { Context, Effect, Layer, Ref } from "effect";
import type { ServerWebSocket } from "bun";
import type { CortexLiveMessage } from "../types.js";
import { CortexError } from "../errors.js";
import { cortexLog } from "../cortex-log.js";

type SubscriberSet = Set<ServerWebSocket<unknown>>;

export class CortexEventBridge extends Context.Tag("CortexEventBridge")<
  CortexEventBridge,
  {
    readonly subscribe: (
      agentId: string,
      ws: ServerWebSocket<unknown>,
    ) => Effect.Effect<void, never>;
    readonly unsubscribe: (
      agentId: string,
      ws: ServerWebSocket<unknown>,
    ) => Effect.Effect<void, never>;
    readonly broadcast: (agentId: string, msg: CortexLiveMessage) => Effect.Effect<void, never>;
    readonly subscriberCount: (agentId: string) => Effect.Effect<number, never>;
    readonly replayTo: (
      agentId: string,
      runId: string,
      ws: ServerWebSocket<unknown>,
      events: Array<{ ts: number; type: string; payload: string }>,
    ) => Effect.Effect<void, CortexError>;
  }
>() {}

const getOrCreateSet = (agentId: string, map: Map<string, SubscriberSet>): SubscriberSet => {
  const existing = map.get(agentId);
  if (existing) return existing;
  const created = new Set<ServerWebSocket<unknown>>();
  map.set(agentId, created);
  return created;
};

export const CortexEventBridgeLive = Layer.effect(
  CortexEventBridge,
  Effect.gen(function* () {
    const subscribersRef = yield* Ref.make(new Map<string, SubscriberSet>());

    return {
      subscribe: (agentId, ws) =>
        Ref.update(subscribersRef, (map) => {
          const copy = new Map(map);
          const set = new Set(getOrCreateSet(agentId, copy));
          set.add(ws);
          copy.set(agentId, set);
          return copy;
        }),

      unsubscribe: (agentId, ws) =>
        Ref.update(subscribersRef, (map) => {
          const copy = new Map(map);
          const set = new Set(getOrCreateSet(agentId, copy));
          set.delete(ws);
          copy.set(agentId, set);
          return copy;
        }),

      broadcast: (agentId, msg) =>
        Effect.gen(function* () {
          const map = yield* Ref.get(subscribersRef);
          const subscribers = map.get(agentId) ?? new Set();
          const json = JSON.stringify(msg);
          if (subscribers.size === 0) {
            cortexLog("debug", "bridge", "broadcast: no subscribers", {
              agentId,
              type: msg.type,
              runId: msg.runId,
            });
          }
          for (const socket of subscribers) {
            yield* Effect.sync(() => {
              try {
                socket.send(json);
              } catch {
                /* client disconnected */
              }
            });
          }
        }),

      subscriberCount: (agentId) =>
        Ref.get(subscribersRef).pipe(Effect.map((map) => map.get(agentId)?.size ?? 0)),

      replayTo: (agentId, runId, ws, events) =>
        Effect.gen(function* () {
          for (const row of events) {
            const msg: CortexLiveMessage = {
              v: 1,
              ts: row.ts,
              agentId,
              runId,
              source: "eventbus",
              type: row.type,
              payload: JSON.parse(row.payload) as Record<string, unknown>,
            };
            yield* Effect.sync(() => {
              try {
                ws.send(JSON.stringify(msg));
              } catch {
                /* ok */
              }
            });
          }
        }),
    };
  }),
);
