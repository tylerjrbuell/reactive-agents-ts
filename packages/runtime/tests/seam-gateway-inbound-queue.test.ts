import { describe, it, expect } from "bun:test";
import { Effect, Layer, ManagedRuntime } from "effect";
import type { AgentEvent } from "@reactive-agents/core";
import {
  makeGatewayInboundQueue,
  type GatewayInboundQueueDeps,
  type InboundQueueDecision,
} from "../src/agent/gateway-inbound-queue.js";
import { makeGatewayTick } from "../src/agent/gateway-tick.js";

/** A run that blocks until released, recording start order. */
const gatedRun = () => {
  const started: string[] = [];
  const gates: Array<() => void> = [];
  const run: GatewayInboundQueueDeps["run"] = (_e, source, instruction) =>
    new Promise((resolve) => {
      started.push(`${source}:${instruction}`);
      gates.push(() => resolve(`out:${instruction}`));
    });
  return { run, started, release: () => gates.shift()?.() };
};

const mkQueue = (over: Partial<GatewayInboundQueueDeps> & Pick<GatewayInboundQueueDeps, "run">) => {
  const events: AgentEvent[] = [];
  let stamp = "w1";
  let decision: InboundQueueDecision = { action: "execute" };
  const queue = makeGatewayInboundQueue({
    publish: async (e) => {
      events.push(e);
    },
    glog: (() => {}) as never,
    agentId: "a",
    getStopped: () => false,
    reevaluate: async () => decision,
    windowStamp: async () => stamp,
    ...over,
  });
  return {
    queue,
    events,
    rollWindow: (d: InboundQueueDecision = { action: "execute" }) => {
      stamp = `w${Math.random()}`;
      decision = d;
    },
  };
};
const tick = () => new Promise<void>((r) => setTimeout(r, 5));
const policies = (events: AgentEvent[]) =>
  events.flatMap((e) => (e._tag === "ProactiveActionSuppressed" ? [e.policy] : []));

describe("gateway inbound queue (seam)", () => {
  it("overlapping events queue and run in FIFO order; none dropped", async () => {
    const g = gatedRun();
    const { queue, events } = mkQueue({ run: g.run });
    const outs = [1, 2, 3, 4, 5].map((n) => queue.submit({ id: `e${n}` }, "channel", `m${n}`));
    await tick();
    expect(g.started).toEqual(["channel:m1"]);
    for (let i = 0; i < 5; i++) {
      g.release();
      await tick();
    }
    expect(g.started).toEqual(["m1", "m2", "m3", "m4", "m5"].map((m) => `channel:${m}`));
    expect(await Promise.all(outs)).toEqual(["m1", "m2", "m3", "m4", "m5"].map((m) => `out:${m}`));
    expect(policies(events).filter((p) => p === "inbound-queue:queued")).toHaveLength(4);
    expect(policies(events)).not.toContain("inbound-queue:dropped");
  });

  it("cron due during a chat reply: tick returns without waiting, both run in order", async () => {
    const g = gatedRun();
    const { queue } = mkQueue({ run: g.run });
    const rt = ManagedRuntime.make(Layer.empty);
    const cronEvent = { id: "c1", source: "cron", metadata: { instruction: "nightly" } };
    const runTick = makeGatewayTick({
      runtime: rt as never,
      agentId: "a",
      hasCustomHeartbeatInstruction: false,
      sessionTtlDays: 30,
      gw: { processEvent: () => Effect.succeed({ action: "execute", taskDescription: "x" }) } as never,
      sched: {
        emitHeartbeat: () => Effect.succeed({ id: "h", source: "heartbeat", metadata: {} }),
        checkCrons: () => Effect.succeed([cronEvent]),
      } as never,
      glog: (() => {}) as never,
      queue,
      chatManager: { pruneStaleSessions: async () => {} } as never,
      getStopped: () => false,
      incrementHeartbeats: () => 1,
      incrementCronChecks: () => 1,
      getLastCompactionAt: () => Date.now(),
      setLastCompactionAt: () => {},
    });

    const chat = queue.submit({}, "channel", "chat-reply"); // agent now busy
    await tick();
    // Tick must finish while the chat run is still blocked (no inline agent work).
    await runTick();
    expect(g.started).toEqual(["channel:chat-reply"]);
    expect(queue.depth().ready).toBe(1);
    g.release();
    await chat;
    await tick();
    g.release();
    await queue.idle();
    expect(g.started).toEqual(["channel:chat-reply", "cron:nightly"]);
    await rt.dispose();
  });

  it("policy queue defers, holds while the window has not rolled, and drains after the roll", async () => {
    const ran: string[] = [];
    const { queue, events, rollWindow } = mkQueue({
      run: async (_e, s, i) => (ran.push(`${s}:${i}`), "ok"),
    });
    await queue.defer({ id: "d1" }, "cron", "later", "rate limit");
    expect(queue.depth()).toEqual({ ready: 0, deferred: 1 });
    expect(policies(events)).toContain("inbound-queue:deferred");

    await queue.retryDeferred(); // window unchanged
    await queue.idle();
    expect(ran).toEqual([]);
    expect(queue.depth().deferred).toBe(1);

    rollWindow({ action: "queue" }); // rolled but policy still says queue
    await queue.retryDeferred();
    expect(ran).toEqual([]);
    expect(queue.depth().deferred).toBe(1);

    rollWindow({ action: "execute" });
    await queue.retryDeferred();
    await queue.idle();
    expect(ran).toEqual(["cron:later"]);
    expect(queue.depth()).toEqual({ ready: 0, deferred: 0 });
  });

  it("deferred chat turn re-enters via its release callback, not the run queue", async () => {
    const ran: string[] = [];
    const { queue, rollWindow } = mkQueue({ run: async () => (ran.push("run"), "ok") });
    const released: string[] = [];
    await queue.defer({}, "channel", "hi", "budget", async () => void released.push("turn"));
    rollWindow();
    await queue.retryDeferred();
    await queue.idle();
    expect(released).toEqual(["turn"]);
    expect(ran).toEqual([]);
  });

  it("overflow drop-oldest: typed event, oldest settles undefined, newest survive", async () => {
    const g = gatedRun();
    const { queue, events } = mkQueue({ run: g.run, capacity: 2, overflow: "drop-oldest" });
    const first = queue.submit({ id: "e0" }, "channel", "running");
    await tick();
    const a = queue.submit({ id: "e1" }, "channel", "a");
    const b = queue.submit({ id: "e2" }, "channel", "b");
    const c = queue.submit({ id: "e3" }, "channel", "c");
    await tick();
    expect(await a).toBeUndefined();
    expect(policies(events)).toContain("inbound-queue:dropped");
    const dropped = events.find(
      (e) => e._tag === "ProactiveActionSuppressed" && e.policy === "inbound-queue:dropped",
    );
    expect(dropped && dropped._tag === "ProactiveActionSuppressed" && dropped.eventId).toBe("e1");
    for (let i = 0; i < 3; i++) {
      g.release();
      await tick();
    }
    expect(await Promise.all([first, b, c])).toEqual(["out:running", "out:b", "out:c"]);
  });

  it("overflow drop-newest drops the arriving event", async () => {
    const g = gatedRun();
    const { queue, events } = mkQueue({ run: g.run, capacity: 1, overflow: "drop-newest" });
    const first = queue.submit({ id: "e0" }, "channel", "running");
    await tick();
    const a = queue.submit({ id: "e1" }, "channel", "a");
    const b = queue.submit({ id: "e2" }, "channel", "b");
    await tick();
    expect(await b).toBeUndefined();
    expect(policies(events)).toContain("inbound-queue:dropped");
    g.release();
    await tick();
    g.release();
    expect(await Promise.all([first, a])).toEqual(["out:running", "out:a"]);
  });

  it("reevaluate rejecting for one deferred job does not lose the rest of the batch", async () => {
    const ran: string[] = [];
    const settledSeen: string[] = [];
    let failFor = "";
    const { queue, events, rollWindow } = mkQueue({
      run: async (_e, _s, i) => (ran.push(i), "ok"),
      reevaluate: async (e) => {
        if ((e as { id: string }).id === failFor) throw new Error("policy backend down");
        return { action: "execute" };
      },
      onSettled: async (s) => {
        settledSeen.push(`${s.outcome}:${(s.event as { id: string }).id}`);
      },
    });
    await queue.defer({ id: "j1" }, "cron", "one", "rate limit");
    await queue.defer({ id: "j2" }, "cron", "two", "rate limit");
    await queue.defer({ id: "j3" }, "cron", "three", "rate limit");
    failFor = "j2";
    rollWindow();
    await queue.retryDeferred();
    await queue.idle();
    expect(ran).toEqual(["one", "three"]);
    expect(settledSeen).toContain("skipped:j2");
    expect(settledSeen).toContain("ran:j1");
    expect(settledSeen).toContain("ran:j3");
    expect(policies(events)).toContain("inbound-queue:dropped");
    expect(queue.depth()).toEqual({ ready: 0, deferred: 0 });
  });
});
