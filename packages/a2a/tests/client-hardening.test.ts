// Run: bun run repo test packages/a2a/tests/client-hardening.test.ts
// Security audit 2026-11-12: client timeout, response size cap, egress policy; server auth coverage.
import { afterEach, describe, expect, it } from "bun:test";
import { Effect, Layer } from "effect";
import { A2AClient, createA2AClient, type ClientConfig } from "../src/client/a2a-client.js";
import { A2AHttpServer, createA2AHttpServer } from "../src/server/http-server.js";
import { createA2AServer } from "../src/server/a2a-server.js";
import type { AgentCard } from "../src/types.js";

const servers: Array<{ stop: (force?: boolean) => void }> = [];
afterEach(() => {
  while (servers.length) servers.pop()?.stop(true);
});

const send = (cfg: ClientConfig) =>
  Effect.runPromiseExit(
    Effect.gen(function* () {
      const c = yield* A2AClient;
      return yield* c.getTask({ id: "t1" });
    }).pipe(Effect.provide(createA2AClient(cfg))),
  );

const failureTag = (exit: Awaited<ReturnType<typeof send>>): string | undefined => {
  if (exit._tag !== "Failure") return undefined;
  const cause = exit.cause;
  return cause._tag === "Fail" ? (cause.error as { _tag: string })._tag : undefined;
};

describe("A2A client request timeout", () => {
  it("RED-ON-CUT: a hung server yields RequestTimeoutError", async () => {
    const hung = Bun.serve({ port: 0, fetch: () => new Promise<Response>(() => undefined) });
    servers.push(hung);
    const started = Date.now();
    const exit = await send({ baseUrl: `http://127.0.0.1:${hung.port}`, allowPrivateNetwork: true, timeoutMs: 200 });
    expect(failureTag(exit)).toBe("RequestTimeoutError");
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it("RED-ON-CUT: a body that stalls mid-stream also times out", async () => {
    const stall = Bun.serve({
      port: 0,
      fetch: () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(c) {
              c.enqueue(new TextEncoder().encode('{"jsonrpc":"2.0"'));
            },
          }),
        ),
    });
    servers.push(stall);
    const exit = await send({ baseUrl: `http://127.0.0.1:${stall.port}`, allowPrivateNetwork: true, timeoutMs: 200 });
    expect(failureTag(exit)).toBe("RequestTimeoutError");
  });
});

describe("A2A client response size cap", () => {
  it("RED-ON-CUT: a chunked oversize body yields ResponseTooLargeError", async () => {
    const big = Bun.serve({
      port: 0,
      fetch: () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(c) {
              const chunk = new TextEncoder().encode("x".repeat(1024));
              for (let i = 0; i < 64; i++) c.enqueue(chunk);
              c.close();
            },
          }),
        ),
    });
    servers.push(big);
    const exit = await send({ baseUrl: `http://127.0.0.1:${big.port}`, allowPrivateNetwork: true, maxResponseBytes: 4096 });
    expect(failureTag(exit)).toBe("ResponseTooLargeError");
  });

  it("an in-cap response still succeeds", async () => {
    const ok = Bun.serve({
      port: 0,
      fetch: () => Response.json({ jsonrpc: "2.0", id: 1, result: { id: "t1" } }),
    });
    servers.push(ok);
    const exit = await send({ baseUrl: `http://127.0.0.1:${ok.port}`, allowPrivateNetwork: true, maxResponseBytes: 4096 });
    expect(exit._tag).toBe("Success");
  });
});

describe("A2A client egress policy", () => {
  it("RED-ON-CUT: allowPrivateNetwork:false denies a loopback target", async () => {
    const local = Bun.serve({ port: 0, fetch: () => Response.json({ result: {} }) });
    servers.push(local);
    const exit = await send({ baseUrl: `http://127.0.0.1:${local.port}`, allowPrivateNetwork: false });
    expect(failureTag(exit)).toBe("EgressDeniedError");
  });

  it("strictEgress denies loopback; allowPrivateNetwork:true overrides it", async () => {
    const local = Bun.serve({ port: 0, fetch: () => Response.json({ jsonrpc: "2.0", id: 1, result: { id: "t1" } }) });
    servers.push(local);
    const baseUrl = `http://127.0.0.1:${local.port}`;
    expect(failureTag(await send({ baseUrl, egress: { strictEgress: true } }))).toBe("EgressDeniedError");
    expect((await send({ baseUrl, egress: { strictEgress: true }, allowPrivateNetwork: true }))._tag).toBe("Success");
  });

  it("cloud metadata is denied even with allowPrivateNetwork", async () => {
    const exit = await send({ baseUrl: "http://169.254.169.254/", allowPrivateNetwork: true });
    expect(failureTag(exit)).toBe("EgressDeniedError");
  });

  it("RED-ON-CUT: a redirect is refused, not followed", async () => {
    const target = Bun.serve({ port: 0, fetch: () => Response.json({ jsonrpc: "2.0", id: 1, result: { id: "leak" } }) });
    const redirector = Bun.serve({
      port: 0,
      fetch: () => Response.redirect(`http://127.0.0.1:${target.port}/`, 307),
    });
    servers.push(target, redirector);
    const exit = await send({ baseUrl: `http://127.0.0.1:${redirector.port}`, allowPrivateNetwork: true });
    expect(failureTag(exit)).toBe("EgressDeniedError");
  });
});

describe("A2A server auth coverage (secureServe bearer token)", () => {
  const card: AgentCard = {
    name: "Auth Agent",
    version: "0.1.0",
    url: "http://localhost:0",
    provider: { organization: "Test" },
    capabilities: { streaming: false },
  };

  it("RED-ON-CUT: every route 401s without the token, passes with it, 401s on a wrong one", async () => {
    const layer = createA2AHttpServer(0, undefined, undefined, { token: "s3cret" }).pipe(
      Layer.provide(createA2AServer(card)),
    );
    const { port, stop } = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* A2AHttpServer;
        const port = yield* svc.start();
        return { port, stop: () => Effect.runPromise(svc.stop()) };
      }).pipe(Effect.provide(layer)),
    );
    servers.push({ stop: () => void stop() });
    const base = `http://127.0.0.1:${port}`;
    const rpc = { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "agent/card" }) };
    const routes: Array<[string, RequestInit]> = [
      ["/", rpc],
      ["/agent/card", { method: "GET" }],
      ["/.well-known/agent.json", { method: "GET" }],
    ];
    for (const [path, init] of routes) {
      expect((await fetch(base + path, init)).status).toBe(401);
      expect((await fetch(base + path, { ...init, headers: { Authorization: "Bearer nope" } })).status).toBe(401);
      expect((await fetch(base + path, { ...init, headers: { Authorization: "Bearer s3cret" } })).status).toBe(200);
    }
    // X-API-Key is NOT accepted by the server (client `auth.type: "apiKey"` mismatch, see report).
    expect((await fetch(base + "/agent/card", { headers: { "X-API-Key": "s3cret" } })).status).toBe(401);
  });
});
