import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import crypto from "node:crypto";
import { connect } from "node:net";
import { startIngress } from "../../src/ingress/ingress-server.js";
import { WebhookServiceLive } from "../../src/services/webhook-service.js";
import type { GatewayEvent } from "../../src/types.js";

const SECRET = "whsec-test";
const sign = (body: string) => crypto.createHmac("sha256", SECRET).update(body).digest("hex");

const withIngress = async (
  opts: { bodyTimeoutMs?: number; maxInFlight?: number; onEvent?: (e: GatewayEvent) => Promise<void> },
  f: (ctx: { url: string; port: number }) => Promise<void>,
): Promise<void> => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const ingress = yield* startIngress({
        ...(opts.bodyTimeoutMs !== undefined ? { bodyTimeoutMs: opts.bodyTimeoutMs } : {}),
        ...(opts.maxInFlight !== undefined ? { maxInFlight: opts.maxInFlight } : {}),
        onEvent: (e) => Effect.promise(() => opts.onEvent?.(e) ?? Promise.resolve()),
      });
      yield* Effect.promise(() => f({ url: ingress.url, port: ingress.port }));
    }).pipe(
      Effect.provide(WebhookServiceLive([{ path: "/hooks/generic", adapter: "generic", secret: SECRET }])),
      Effect.scoped,
    ),
  );
};

describe("ingress limits", () => {
  test("a sender that stalls mid-body gets 408 within the body timeout (slowloris)", async () => {
    await withIngress({ bodyTimeoutMs: 150 }, async ({ port }) => {
      const started = Date.now();
      const response = await new Promise<string>((resolve, reject) => {
        const socket = connect({ host: "127.0.0.1", port }, () => {
          // Promise 100 bytes, send 3, then go quiet.
          socket.write("POST /hooks/generic HTTP/1.1\r\nHost: x\r\nContent-Length: 100\r\n\r\nabc");
        });
        let data = "";
        socket.on("data", (d) => {
          data += d.toString("utf8");
          if (data.includes("\r\n\r\n")) {
            socket.destroy();
            resolve(data);
          }
        });
        socket.on("error", reject);
        setTimeout(() => {
          socket.destroy();
          reject(new Error("no response: the stalled body was never cut off"));
        }, 3000);
      });
      expect(response.startsWith("HTTP/1.1 408")).toBe(true);
      expect(Date.now() - started).toBeLessThan(2500);
    });
  });

  test("requests beyond maxInFlight are shed with 503 and the slot frees afterwards", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let entered: () => void = () => undefined;
    const inHandler = new Promise<void>((r) => {
      entered = r;
    });
    let calls = 0;
    await withIngress(
      {
        maxInFlight: 1,
        onEvent: async () => {
          calls += 1;
          entered();
          await gate;
        },
      },
      async ({ url }) => {
        const body = JSON.stringify({ n: 1 });
        const headers = { "x-webhook-signature": sign(body) };
        const first = fetch(`${url}/hooks/generic`, { method: "POST", body, headers });
        await inHandler; // first request now holds the only slot
        const second = await fetch(`${url}/hooks/generic`, { method: "POST", body, headers });
        expect(second.status).toBe(503);
        release();
        expect((await first).status).toBe(202);
        const third = await fetch(`${url}/hooks/generic`, { method: "POST", body, headers });
        expect(third.status).toBe(202);
        expect(calls).toBe(2);
      },
    );
  });
});
