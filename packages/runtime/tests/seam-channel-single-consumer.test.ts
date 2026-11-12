/**
 * Seam pin: one consumer per inbound channel message.
 *
 * The channel router publishes `ChannelMessageReceived` (with `adapterId`) AND runs the message
 * itself. The legacy gateway-driver subscriber consumes the same event; if it also started a chat
 * run, every routed message ran twice, bypassing the router's access decision and meters
 * (2026-11-12 Telegram trace diagnosis, gap G2). The legacy subscriber must skip adapters the router
 * owns, and must not tell the model to call an MCP send tool for a native adapter (gap G1).
 */
import { describe, it, expect } from "bun:test";
import { Effect, Layer, ManagedRuntime } from "effect";
import { EventBus, EventBusLive } from "@reactive-agents/core";
import {
  subscribeChannelHandler,
  routerOwnedAdapterIds,
  type SubscribeChannelHandlerDeps,
} from "../src/agent/gateway-driver.js";
import { channelOutboundToolGuidance } from "../src/gateway-context-formatting.js";

type Call = { sender: string; message: string; mcpServer: string; adapterBacked: boolean | undefined };

const harness = async (owned: ReadonlySet<string> | undefined) => {
  const runtime = ManagedRuntime.make(Layer.mergeAll(EventBusLive));
  const eb = await runtime.runPromise(EventBus);
  const calls: Call[] = [];
  const deps: SubscribeChannelHandlerDeps = {
    eb,
    gw: { processEvent: () => Effect.succeed({ action: "execute" as const }) } as never,
    glog: () => {},
    channelMode: "chat" as const,
    channelOutboundToolGuidance,
    queue: { enqueue: () => {}, defer: async () => {}, submit: async () => undefined } as never,
    chatManager: {
      handleMessage: async (sender: string, message: string, _p: string, mcpServer: string, _e: unknown, adapterBacked?: boolean) => {
        calls.push({ sender, message, mcpServer, adapterBacked });
      },
    } as never,
    runtime,
    agentId: "a",
    getStopped: () => false,
    incrementChatTurns: () => {},
    ...(owned ? { routerOwnedAdapterIds: owned } : {}),
  };
  const unsub = await subscribeChannelHandler(deps);
  const publish = async (extra: { adapterId?: string }, message: string) => {
    await runtime.runPromise(
      eb.publish({
        _tag: "ChannelMessageReceived",
        sender: "u1",
        platform: "telegram",
        message,
        timestamp: Date.now(),
        mcpServer: extra.adapterId ?? "signal",
        ...extra,
      }),
    );
    await new Promise((r) => setTimeout(r, 20));
  };
  return { calls, publish, stop: async () => { unsub(); await runtime.dispose(); } };
};

describe("legacy gateway subscriber vs the channel router", () => {
  it("does NOT run a chat turn for a router-owned adapter", async () => {
    const h = await harness(new Set(["ch-routed"]));
    await h.publish({ adapterId: "ch-routed" }, "hello routed");
    expect(h.calls).toEqual([]);
    await h.stop();
  });

  it("still runs a chat turn for an adapter the router does not own, without MCP send guidance flag off", async () => {
    const h = await harness(new Set(["ch-routed"]));
    await h.publish({ adapterId: "ch-legacy-native" }, "hello native");
    expect(h.calls).toEqual([{ sender: "u1", message: "hello native", mcpServer: "ch-legacy-native", adapterBacked: true }]);
    await h.stop();
  });

  it("MCP-sourced messages (no adapterId) keep the legacy path and MCP guidance", async () => {
    const h = await harness(new Set(["ch-routed"]));
    await h.publish({}, "hello mcp");
    expect(h.calls).toEqual([{ sender: "u1", message: "hello mcp", mcpServer: "signal", adapterBacked: false }]);
    await h.stop();
  });

  it("routerOwnedAdapterIds: every adapter id when routes are set, none otherwise", () => {
    const adapters = [{ id: "ch-a" }, { id: "ch-b" }];
    expect([...routerOwnedAdapterIds({ routes: [{}], adapters })]).toEqual(["ch-a", "ch-b"]);
    expect([...routerOwnedAdapterIds({ adapters })]).toEqual([]);
    expect([...routerOwnedAdapterIds({ routes: [], adapters })]).toEqual([]);
    expect([...routerOwnedAdapterIds(undefined)]).toEqual([]);
  });
});

describe("outbound tool guidance by channel kind", () => {
  it("a native adapter gets no 'call an MCP send tool' instruction", () => {
    expect(channelOutboundToolGuidance({ mcpServer: "ch-d6d3de1f", sender: "u1", adapterBacked: true })).toBe("");
  });

  it("an MCP channel keeps the send-tool instruction", () => {
    const g = channelOutboundToolGuidance({ mcpServer: "signal", sender: "u1" });
    expect(g).toContain('starts with "signal/"');
  });
});
