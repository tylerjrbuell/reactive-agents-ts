// Run: bun test packages/runtime/tests/seam-gateway-declared-outbound.test.ts --timeout 20000
//
// Legacy gateway channel turns deliver their reply by calling the channel server's send tool. Since
// requirement basis (kernel 65aba0d1a) prose-inferred requirements only advise, so the gateway
// DECLARES the send tool as a required tool; the router/adapter path does not.
//
// Chain: gateway-driver stamps event.metadata.outboundServer (MCP only) -> execute-event copies it to
// task.metadata.context -> setup/pre-loop-dispatch adds the one send tool to effectiveRequiredTools
// (kernel KernelInput.requiredTools = declared basis).
//
// RED-ON-CUT:
//  - drop the `outboundServer` spread in agent/gateway-driver.ts            -> driver pins red.
//  - drop `...outboundServerCarry(_event)` in agent/execute-event.ts         -> carry pin red.
//  - drop withDeclaredOutbound(...) in setup/pre-loop-dispatch.ts            -> call-site pin red.
//  - make outboundServerOf ignore adapterBacked                              -> router-path pins red.
import { describe, it, expect } from "bun:test";
import { Effect, Layer, ManagedRuntime } from "effect";
import { readFileSync } from "node:fs";
import { EventBus, EventBusLive, type Task } from "@reactive-agents/core";
import { subscribeChannelHandler } from "../src/agent/gateway-driver.js";
import { makeExecuteEvent } from "../src/agent/execute-event.js";
import { channelOutboundToolGuidance } from "../src/gateway-context-formatting.js";
import {
  declaredOutboundTool,
  outboundServerOf,
  withDeclaredOutbound,
} from "../src/agent/gateway-outbound-requirement.js";

const defs = (...names: string[]) => names.map((name) => ({ name }));

describe("declaredOutboundTool picks one unambiguous send tool", () => {
  it("prefers the primary send action under the server prefix", () => {
    expect(declaredOutboundTool("signal", ["web-search", "signal/send_reaction", "signal/send_message"])).toBe("signal/send_message");
  });
  it("accepts a single loosely-named send tool", () => {
    expect(declaredOutboundTool("tg", ["tg/get_updates", "tg/send_photo"])).toBe("tg/send_photo");
  });
  it("ambiguous or absent: no requirement (never several, never a guess)", () => {
    expect(declaredOutboundTool("tg", ["tg/send_photo", "tg/send_video"])).toBeUndefined();
    expect(declaredOutboundTool("signal", ["web-search", "other/send_message"])).toBeUndefined();
    expect(declaredOutboundTool("signal", [])).toBeUndefined();
  });
});

describe("withDeclaredOutbound", () => {
  const task = (server?: string) => ({ metadata: { context: server ? { outboundServer: server } : {} } });
  it("adds the send tool to the required set when the task carries an outbound server", () => {
    expect(withDeclaredOutbound(undefined, task("signal"), defs("web-search", "signal/send_message"))).toEqual(["signal/send_message"]);
    expect(withDeclaredOutbound(["web-search"], task("signal"), defs("signal/send_message"))).toEqual(["web-search", "signal/send_message"]);
  });
  it("router/adapter task (no outbound server): required set untouched", () => {
    expect(withDeclaredOutbound(undefined, task(), defs("signal/send_message"))).toBeUndefined();
    expect(withDeclaredOutbound(["a"], task(), defs("signal/send_message"))).toEqual(["a"]);
  });
  it("outbound tool absent from the surface: no tool, no requirement", () => {
    expect(withDeclaredOutbound(undefined, task("signal"), defs("web-search"))).toBeUndefined();
  });
});

describe("outboundServerOf", () => {
  it("MCP channel yields the server; adapter-backed or blank yields none", () => {
    expect(outboundServerOf(" signal ", false)).toBe("signal");
    expect(outboundServerOf("ch-abc", true)).toBeUndefined();
    expect(outboundServerOf("  ", false)).toBeUndefined();
    expect(outboundServerOf(undefined, false)).toBeUndefined();
  });
});

describe("gateway-driver stamps the outbound server only for MCP-delivered turns", () => {
  const harness = async () => {
    const runtime = ManagedRuntime.make(Layer.mergeAll(EventBusLive));
    const eb = await runtime.runPromise(EventBus);
    const events: Array<{ metadata?: Record<string, unknown> }> = [];
    const unsub = await subscribeChannelHandler({
      eb,
      gw: { processEvent: () => Effect.succeed({ action: "execute" as const }) } as never,
      glog: () => {},
      channelMode: "chat" as const,
      channelOutboundToolGuidance,
      queue: { enqueue: () => {}, defer: async () => {}, submit: async () => undefined } as never,
      chatManager: {
        handleMessage: async (_s: string, _m: string, _p: string, _srv: string, e: unknown) => {
          events.push(e as { metadata?: Record<string, unknown> });
        },
      } as never,
      runtime,
      agentId: "a",
      getStopped: () => false,
      incrementChatTurns: () => {},
    });
    const publish = async (extra: { adapterId?: string }) => {
      await runtime.runPromise(
        eb.publish({
          _tag: "ChannelMessageReceived",
          sender: "u1",
          platform: "telegram",
          message: "hi",
          timestamp: Date.now(),
          mcpServer: extra.adapterId ?? "signal",
          ...extra,
        }),
      );
      await new Promise((r) => setTimeout(r, 20));
    };
    return { events, publish, stop: async () => { unsub(); await runtime.dispose(); } };
  };

  it("MCP message: event metadata names the outbound server", async () => {
    const h = await harness();
    await h.publish({});
    expect(h.events[0]?.metadata?.["outboundServer"]).toBe("signal");
    await h.stop();
  });

  it("native-adapter message: no outbound server (the adapter delivers the reply)", async () => {
    const h = await harness();
    await h.publish({ adapterId: "ch-native" });
    expect(h.events).toHaveLength(1);
    expect(h.events[0]?.metadata).not.toHaveProperty("outboundServer");
    await h.stop();
  });
});

describe("execute-event carries the outbound server onto the task context", () => {
  const run = async (event: unknown): Promise<Task> => {
    const tasks: Task[] = [];
    const exec = makeExecuteEvent({
      publish: async () => {},
      glog: (() => {}) as never,
      engine: { execute: (t) => (tasks.push(t), Effect.fail({ message: "stop here" } as never)) },
      runtime: ManagedRuntime.make(EventBusLive) as never,
      gw: {} as never,
      agentId: "a",
      persistMemory: true,
      incrementTotalRuns: () => {},
    });
    await exec(event, "channel", "msg");
    return tasks[0]!;
  };

  it("event with metadata.outboundServer -> task.metadata.context.outboundServer", async () => {
    const t = await run({ metadata: { outboundServer: "signal" } });
    expect(t.metadata?.context?.["outboundServer"]).toBe("signal");
  });

  it("event without it (router/adapter/heartbeat) -> no outboundServer key", async () => {
    const t = await run({ metadata: { mcpServer: "ch-native" } });
    expect(t.metadata?.context).not.toHaveProperty("outboundServer");
    expect(t.metadata?.context?.["origin"]).toBe("gateway");
  });
});

describe("pre-loop dispatch applies the declaration", () => {
  it("setup/pre-loop-dispatch.ts feeds classified required tools through withDeclaredOutbound", () => {
    const src = readFileSync(
      new URL("../src/engine/phases/agent-loop/setup/pre-loop-dispatch.ts", import.meta.url),
      "utf8",
    );
    expect(src).toMatch(/withDeclaredOutbound\(\s*classified\.effectiveRequiredTools/);
  });
});
