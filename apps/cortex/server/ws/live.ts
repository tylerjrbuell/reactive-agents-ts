import type { Context } from "effect";
import { Effect, Layer, Option } from "effect";
import type { ElysiaWS } from "elysia/ws";
import { CortexEventBridge } from "../services/event-bridge.js";
import { CortexStoreService } from "../services/store-service.js";
import { cortexLog } from "../cortex-log.js";
import { CORTEX_DESK_LIVE_AGENT_ID } from "../types.js";

export type LiveWsData = {
  readonly agentId?: string;
  readonly runId?: string;
};

/** Elysia's `ws.raw` is a Bun socket; normalize for our subscriber set typing. */
const asSubscriberSocket = (raw: { send: (data: string) => unknown }): import("bun").ServerWebSocket<unknown> =>
  raw as import("bun").ServerWebSocket<unknown>;

function resolveSubscriptionAgentId(data: LiveWsData): string {
  return data.agentId && data.agentId.trim() ? data.agentId : CORTEX_DESK_LIVE_AGENT_ID;
}

export function handleLiveOpen(
  ws: ElysiaWS<LiveWsData>,
  bridge: Context.Tag.Service<CortexEventBridge>,
): void {
  const agentId = resolveSubscriptionAgentId(ws.data);
  cortexLog("info", "live-ws", "client subscribed", {
    agentId,
    runId: ws.data.runId ?? null,
  });
  Effect.runFork(bridge.subscribe(agentId, asSubscriberSocket(ws.raw)));
}

export function handleLiveClose(
  ws: ElysiaWS<LiveWsData>,
  bridge: Context.Tag.Service<CortexEventBridge>,
): void {
  const agentId = resolveSubscriptionAgentId(ws.data);
  cortexLog("debug", "live-ws", "client unsubscribed", { agentId });
  Effect.runFork(bridge.unsubscribe(agentId, asSubscriberSocket(ws.raw)));
}

export async function replayRunEvents(
  ws: ElysiaWS<LiveWsData>,
  storeLayer: Layer.Layer<CortexStoreService>,
  bridgeLayer: Layer.Layer<CortexEventBridge>,
): Promise<void> {
  const { runId } = ws.data;
  if (!runId) return;

  const program = Effect.gen(function* () {
    const store = yield* CortexStoreService;
    const bridge = yield* CortexEventBridge;
    const run = yield* store.getRun(runId);
    const resolvedAgentId = Option.isSome(run)
      ? run.value.agentId
      : resolveSubscriptionAgentId(ws.data);
    const events = yield* store.getRunEvents(runId);
    cortexLog("debug", "live-ws", "replaying persisted events", {
      agentId: resolvedAgentId,
      runId,
      count: events.length,
    });
    yield* bridge.replayTo(resolvedAgentId, runId, asSubscriberSocket(ws.raw), events);
  });

  await Effect.runPromise(
    program.pipe(Effect.provide(Layer.merge(storeLayer, bridgeLayer)), Effect.ignoreLogged),
  );
}
