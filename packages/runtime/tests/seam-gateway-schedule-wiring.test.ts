import { describe, it, expect } from "bun:test";
import crypto from "node:crypto";
import { Effect, Layer, ManagedRuntime } from "effect";
import {
  SchedulerServiceLive,
  makeScheduleRegistry,
  createScheduleEvent,
  makeMemoryScheduleStore,
  type ScheduleRegistryService,
} from "@reactive-agents/gateway";
import { deliverScheduleResult } from "@reactive-agents/channels";
import { makeGatewayInboundQueue } from "../src/agent/gateway-inbound-queue.js";
import { makeScheduleReporter } from "../src/agent/gateway-schedule-report.js";
import { makeSchedulesApi } from "../src/agent/schedules-facade.js";
import { startRuntimeIngress } from "../src/agent/gateway-ingress.js";
import { makeGatewayTick } from "../src/agent/gateway-tick.js";
import { scheduleStorePath } from "../src/runtime-gateway-layer.js";

const glogs: string[] = [];
const glog = ((_l: string, m: string) => void glogs.push(m)) as never;

/** In-memory registry plus a due fire for a once-schedule. */
const withRegistry = async <A>(
  f: (registry: ScheduleRegistryService) => Promise<A>,
): Promise<A> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* makeScheduleRegistry({});
      return yield* Effect.promise(() => f(registry));
    }).pipe(Effect.scoped),
  );

const fireOnce = async (
  registry: ScheduleRegistryService,
  extra: { delivery?: { adapterId: string; conversationId: string } } = {},
) => {
  const at = Date.now() + 1000;
  const s = await Effect.runPromise(
    registry.create({ runAt: at, instruction: "daily report", ...extra }),
  );
  const [fire] = await Effect.runPromise(registry.collectDue(at + 1));
  if (!fire) throw new Error("fire expected");
  return { s, event: createScheduleEvent("agent", fire) };
};

const mkQueue = (
  registry: ScheduleRegistryService,
  run: (e: unknown, s: string, i: string) => Promise<string | undefined>,
  channels: Parameters<typeof makeScheduleReporter>[0]["channels"] = null,
) =>
  makeGatewayInboundQueue({
    run,
    publish: async () => {},
    glog,
    agentId: "agent",
    getStopped: () => false,
    reevaluate: async () => ({ action: "execute" }),
    windowStamp: async () => "w",
    onSettled: makeScheduleReporter({
      runtime: ManagedRuntime.make(Layer.empty) as never,
      registry,
      channels,
      deliver: deliverScheduleResult,
      glog,
    }),
  });

describe("cron outcome reaches the ScheduleRegistry (seam)", () => {
  it("a fired cron that succeeds is recorded as succeeded and visible via lastResult", async () => {
    await withRegistry(async (registry) => {
      const { s, event } = await fireOnce(registry);
      const q = mkQueue(registry, async () => "report text");
      q.enqueue(event, "cron", "daily report");
      await q.idle();
      await new Promise((r) => setTimeout(r, 5));
      const last = await Effect.runPromise(registry.lastResult(s.id));
      expect(last?.status).toBe("succeeded");
      expect(last?.fireId).toBe(event.metadata["fireId"] as string);
    });
  });

  it("a failed run is recorded failed; a policy-denied fire is recorded skipped", async () => {
    await withRegistry(async (registry) => {
      const a = await fireOnce(registry);
      const q = mkQueue(registry, async () => undefined);
      q.enqueue(a.event, "cron", "x");
      await q.idle();
      await new Promise((r) => setTimeout(r, 5));
      expect((await Effect.runPromise(registry.lastResult(a.s.id)))?.status).toBe("failed");

      const b = await fireOnce(registry);
      await q.skip(b.event, "cron", "rate limited");
      const last = await Effect.runPromise(registry.lastResult(b.s.id));
      expect(last?.status).toBe("skipped");
      expect(last?.error).toBe("rate limited");
    });
  });

  it("delivers the output through ChannelService.deliver when a target is set, and records the receipt", async () => {
    await withRegistry(async (registry) => {
      const delivered: Array<{ id: string; text: string | undefined }> = [];
      const channels = {
        deliver: (id: string, msg: { text?: string }) =>
          Effect.sync(() => {
            delivered.push({ id, text: msg.text });
            return { messageId: "m-42", status: "sent" };
          }),
      };
      const { s, event } = await fireOnce(registry, {
        delivery: { adapterId: "telegram", conversationId: "chat-1" },
      });
      const q = mkQueue(registry, async () => "the report", channels as never);
      q.enqueue(event, "cron", "daily report");
      await q.idle();
      await new Promise((r) => setTimeout(r, 10));
      expect(delivered).toEqual([{ id: "telegram", text: "the report" }]);
      const last = await Effect.runPromise(registry.lastResult(s.id));
      expect(last?.delivery).toMatchObject({
        status: "delivered",
        messageId: "m-42",
        receiptStatus: "sent",
      });
      // adapterId is additive: when present it must name the target adapter.
      if (last?.delivery?.adapterId !== undefined) expect(last.delivery.adapterId).toBe("telegram");
    });
  });

  it("a crash-recovered fire is re-offered after restart, executed once, and completeRun is recorded", async () => {
    const store = makeMemoryScheduleStore();
    const at = Date.now() + 1000;
    // Lifetime 1: fire is handed out (persisted as running) and the process "dies" before settling.
    const { id, fireId } = await Effect.runPromise(
      Effect.gen(function* () {
        const registry = yield* makeScheduleRegistry({ store });
        const s = yield* registry.create({ runAt: at, instruction: "daily report" });
        const [fire] = yield* registry.collectDue(at + 1);
        if (!fire) throw new Error("fire expected");
        return { id: s.id, fireId: fire.fireId };
      }).pipe(Effect.scoped),
    );
    // Lifetime 2: restart over the same store.
    await Effect.runPromise(
      Effect.gen(function* () {
        const registry = yield* makeScheduleRegistry({ store });
        const fires = yield* registry.collectDue(at + 2);
        expect(fires.map((f) => f.fireId)).toEqual([fireId]);
        const ran: string[] = [];
        const q = mkQueue(registry, async (_e, _s, i) => (ran.push(i), "recovered out"));
        q.enqueue(createScheduleEvent("agent", fires[0]!), "cron", "daily report");
        yield* Effect.promise(() => q.idle());
        yield* Effect.promise(() => new Promise((r) => setTimeout(r, 10)));
        expect(ran).toEqual(["daily report"]);
        const last = yield* registry.lastResult(id);
        expect(last?.fireId).toBe(fireId);
        expect(last?.status).toBe("succeeded");
        // Settled: a further collection must not offer it again.
        expect(yield* registry.collectDue(at + 3)).toEqual([]);
      }).pipe(Effect.scoped),
    );
  });

  it("no delivery target: deliver is never called", async () => {
    await withRegistry(async (registry) => {
      let calls = 0;
      const channels = { deliver: () => (calls++, Effect.succeed({ messageId: "x" })) };
      const { event } = await fireOnce(registry);
      const q = mkQueue(registry, async () => "out", channels as never);
      q.enqueue(event, "cron", "i");
      await q.idle();
      await new Promise((r) => setTimeout(r, 5));
      expect(calls).toBe(0);
    });
  });
});

describe("tick survives a schedule store failure (seam)", () => {
  it("checkCrons failing is logged; the tick still finishes its housekeeping", async () => {
    let pruned = 0;
    const tick = makeGatewayTick({
      runtime: ManagedRuntime.make(Layer.empty) as never,
      agentId: "a",
      hasCustomHeartbeatInstruction: false,
      sessionTtlDays: 30,
      gw: { processEvent: () => Effect.succeed({ action: "skip", reason: "x" }) } as never,
      sched: {
        emitHeartbeat: () => Effect.succeed({ id: "h", source: "heartbeat", metadata: {} }),
        checkCrons: () => Effect.fail({ _tag: "ScheduleStoreError", message: "disk" }),
      } as never,
      glog,
      queue: { depth: () => ({ ready: 0, deferred: 0 }), retryDeferred: async () => {} } as never,
      chatManager: { pruneStaleSessions: async () => void pruned++ } as never,
      getStopped: () => false,
      incrementHeartbeats: () => 1,
      incrementCronChecks: () => 1,
      getLastCompactionAt: () => Date.now(),
      setLastCompactionAt: () => {},
    });
    await tick();
    expect(pruned).toBe(1);
    expect(glogs.some((m) => m.includes("cron check failed: ScheduleStoreError"))).toBe(true);
  });
});

describe("agent.schedules() facade (seam)", () => {
  it("create / list / pause / resume / runNow / lastResult / remove through the live registry", async () => {
    const rt = ManagedRuntime.make(SchedulerServiceLive({ agentId: "a" }));
    const api = makeSchedulesApi(rt as never, true);
    const s = await api.create({ cron: "0 9 * * *", instruction: "morning" });
    expect((await api.list()).map((x) => x.id)).toContain(s.id);
    expect((await api.pause(s.id)).enabled).toBe(false);
    expect((await api.resume(s.id)).enabled).toBe(true);
    const req = await api.runNow(s.id);
    expect(req.scheduleId).toBe(s.id);
    expect(typeof req.fireId).toBe("string");
    expect((await api.get(s.id)).lastRun?.fireId).toBe(req.fireId);
    expect((await api.lastResult(s.id))?.status).toBe("running");
    await api.remove(s.id);
    expect(await api.list()).toEqual([]);
    await rt.dispose();
  });

  it("rejects with ScheduleUnavailableError when the gateway is not enabled", async () => {
    const api = makeSchedulesApi(ManagedRuntime.make(Layer.empty) as never, false);
    await expect(api.list()).rejects.toMatchObject({ _tag: "ScheduleUnavailableError" });
  });
});

describe("schedule store path (seam)", () => {
  it("is in-memory under test conditions", () => {
    expect(scheduleStorePath({ agentId: "a", provider: "test" } as never)).toBeUndefined();
  });
});

describe("ingress feeds the bounded queue (seam)", () => {
  it("a verified webhook is policy-checked and enqueued; a bad signature never reaches the queue", async () => {
    const ran: string[] = [];
    const q = makeGatewayInboundQueue({
      run: async (_e, source, instruction) => (ran.push(`${source}:${instruction}`), "ok"),
      publish: async () => {},
      glog,
      agentId: "a",
      getStopped: () => false,
      reevaluate: async () => ({ action: "execute" }),
      windowStamp: async () => "w",
    });
    const ingress = await startRuntimeIngress({
      config: { port: 0, webhooks: [{ path: "/hooks/generic", adapter: "generic", secret: "s3" }] },
      adapters: [],
      queue: q,
      processEvent: async () => ({ action: "execute", taskDescription: "handle webhook" }),
      glog,
    });
    expect(ingress).not.toBeNull();
    const url = ingress!.server.url;
    const body = JSON.stringify({ n: 1 });
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = crypto.createHmac("sha256", "s3").update(`${ts}.${body}`).digest("hex");
    const bad = await fetch(`${url}/hooks/generic`, {
      method: "POST",
      body,
      headers: { "x-webhook-signature": "00", "x-webhook-timestamp": ts },
    });
    expect(bad.status).toBe(401);
    const ok = await fetch(`${url}/hooks/generic`, {
      method: "POST",
      body,
      headers: { "x-webhook-signature": sig, "x-webhook-timestamp": ts },
    });
    expect(ok.status).toBe(202);
    await q.idle();
    expect(ran).toEqual(["webhook:handle webhook"]);
    await ingress!.stop();
  });

  it("nothing configured: no server is started", async () => {
    const ingress = await startRuntimeIngress({
      config: {},
      adapters: [],
      queue: {} as never,
      processEvent: async () => ({ action: "skip" }),
      glog,
    });
    expect(ingress).toBeNull();
  });
});
