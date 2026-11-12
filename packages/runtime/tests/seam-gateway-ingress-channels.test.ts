import { describe, it, expect } from "bun:test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Effect } from "effect";
import { startRuntimeIngress } from "../src/agent/gateway-ingress.js";

const adapter = (id: string, hits: string[]) => ({
  id,
  handleWebhook: () => Effect.sync(() => void hits.push(id)),
});

const start = (
  channels: false | readonly string[] | undefined,
  hits: string[],
  logs: Array<[string, string]> = [],
) =>
  startRuntimeIngress({
    config: { port: 0, channels },
    adapters: [adapter("a", hits), adapter("b", hits)],
    queue: {} as never,
    processEvent: async () => ({ action: "skip" }),
    glog: ((l: string, m: string) => void logs.push([l, m])) as never,
  });

const post = (url: string, id: string) =>
  fetch(`${url}/channels/${id}`, { method: "POST", body: "{}" });

describe("ingress channel opt-out (seam)", () => {
  it("default serves every webhook-capable adapter", async () => {
    const hits: string[] = [];
    const ingress = await start(undefined, hits);
    expect((await post(ingress!.server.url, "a")).status).toBeLessThan(300);
    expect((await post(ingress!.server.url, "b")).status).toBeLessThan(300);
    expect(hits.sort()).toEqual(["a", "b"]);
    await ingress!.stop();
  });

  it("channels:false serves none (nothing else configured: no server)", async () => {
    const hits: string[] = [];
    expect(await start(false, hits)).toBeNull();
    expect(hits).toEqual([]);
  });

  it("an id allowlist serves only the listed adapters", async () => {
    const hits: string[] = [];
    const ingress = await start(["a"], hits);
    expect((await post(ingress!.server.url, "a")).status).toBeLessThan(300);
    expect((await post(ingress!.server.url, "b")).status).toBe(404);
    expect(hits).toEqual(["a"]);
    await ingress!.stop();
  });

  it("a bind failure logs at warn with the port and reason", async () => {
    const blocker = createServer();
    await new Promise<void>((r) => blocker.listen(0, r));
    const port = (blocker.address() as AddressInfo).port;
    const logs: Array<[string, string]> = [];
    const ingress = await startRuntimeIngress({
      config: { port },
      adapters: [adapter("a", [])],
      queue: {} as never,
      processEvent: async () => ({ action: "skip" }),
      glog: ((l: string, m: string) => void logs.push([l, m])) as never,
    });
    blocker.close();
    expect(ingress).toBeNull();
    const failure = logs.find(([, m]) => m.includes("ingress failed to start"));
    expect(failure?.[0]).toBe("warn");
    expect(failure?.[1]).toContain(String(port));
  });
});
