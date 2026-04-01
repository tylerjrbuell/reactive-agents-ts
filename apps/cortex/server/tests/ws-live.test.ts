import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { Effect } from "effect";
import type { ServerWebSocket } from "bun";
import type { ElysiaWS } from "elysia/ws";
import { Database } from "bun:sqlite";
import { applySchema } from "../db/schema.js";
import { insertEvent, upsertRun } from "../db/queries.js";
import { CortexStoreServiceLive } from "../services/store-service.js";
import { CortexEventBridge, CortexEventBridgeLive } from "../services/event-bridge.js";
import { replayRunEvents, handleLiveOpen, handleLiveClose, type LiveWsData } from "../ws/live.js";

function elysiaLikeWs(data: LiveWsData, sent: string[]): ElysiaWS<LiveWsData> {
  const raw = {
    send(s: string) {
      sent.push(s);
    },
  } as unknown as ServerWebSocket<unknown>;
  return {
    data,
    raw,
  } as unknown as ElysiaWS<LiveWsData>;
}

describe("replayRunEvents", () => {
  let db: Database;
  let storeLayer: ReturnType<typeof CortexStoreServiceLive>;

  beforeEach(() => {
    db = new Database(":memory:");
    applySchema(db);
    storeLayer = CortexStoreServiceLive(db);
  });

  it("no-ops when runId is absent", async () => {
    const sent: string[] = [];
    const ws = elysiaLikeWs({ agentId: "a" }, sent);
    await replayRunEvents(ws, storeLayer, CortexEventBridgeLive);
    expect(sent).toHaveLength(0);
  });

  it("replays persisted events in order", async () => {
    upsertRun(db, "agent-x", "run-x");
    insertEvent(
      db,
      { v: 1, agentId: "agent-x", runId: "run-x", event: { _tag: "TaskCreated", taskId: "t" } },
      0,
    );
    insertEvent(
      db,
      { v: 1, agentId: "agent-x", runId: "run-x", event: { _tag: "AgentStarted", taskId: "t", agentId: "agent-x", provider: "p", model: "m", timestamp: 1 } },
      1,
    );

    const sent: string[] = [];
    const ws = elysiaLikeWs({ agentId: "agent-x", runId: "run-x" }, sent);
    await replayRunEvents(ws, storeLayer, CortexEventBridgeLive);

    expect(sent.length).toBe(2);
    const first = JSON.parse(sent[0]!) as { type: string };
    const second = JSON.parse(sent[1]!) as { type: string };
    expect(first.type).toBe("TaskCreated");
    expect(second.type).toBe("AgentStarted");
  });
});

describe("handleLiveOpen / handleLiveClose", () => {
  const prevCortexLog = process.env.CORTEX_LOG;
  beforeAll(() => {
    process.env.CORTEX_LOG = "error";
  });
  afterAll(() => {
    if (prevCortexLog === undefined) delete process.env.CORTEX_LOG;
    else process.env.CORTEX_LOG = prevCortexLog;
  });

  it("subscribe then unsubscribe clears count on the same bridge instance", async () => {
    const bridge = await Effect.runPromise(
      CortexEventBridge.pipe(Effect.provide(CortexEventBridgeLive)),
    );

    const raw = {
      send(_s: string) {},
    } as unknown as ServerWebSocket<unknown>;
    const ws = { data: { agentId: "live-a" }, raw } as unknown as ElysiaWS<LiveWsData>;

    handleLiveOpen(ws, bridge);
    await new Promise((r) => setTimeout(r, 30));
    expect(await Effect.runPromise(bridge.subscriberCount("live-a"))).toBe(1);

    handleLiveClose(ws, bridge);
    await new Promise((r) => setTimeout(r, 30));
    expect(await Effect.runPromise(bridge.subscriberCount("live-a"))).toBe(0);
  });
});
