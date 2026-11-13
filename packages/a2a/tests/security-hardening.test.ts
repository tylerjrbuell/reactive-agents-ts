// Run: bun run repo test packages/a2a/tests/security-hardening.test.ts
// Security audit M9: stream-counted body cap, bounded task store, discovery egress + redirects.
import { afterEach, describe, expect, it } from "bun:test";
import { Effect, Layer } from "effect";
import { A2AHttpServer, createA2AHttpServer } from "../src/server/http-server.js";
import { A2AServer, createA2AServer } from "../src/server/a2a-server.js";
import { A2AClient, createA2AClient } from "../src/client/a2a-client.js";
import { discoverAgent } from "../src/client/discovery.js";
import type { A2ATask, AgentCard } from "../src/types.js";

const card: AgentCard = {
  name: "Sec Agent",
  version: "0.1.0",
  url: "http://localhost:0",
  provider: { organization: "Test" },
  capabilities: { streaming: false },
};

const servers: Array<{ stop: (force?: boolean) => void }> = [];
afterEach(() => {
  while (servers.length) servers.pop()?.stop(true);
});

describe("A2A HTTP server body cap is stream-counted", () => {
  it("RED-ON-CUT: a chunked body (no Content-Length) over maxBodyBytes gets 413", async () => {
    const layer = createA2AHttpServer(0, undefined, undefined, { maxBodyBytes: 256 }).pipe(
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

    // A small in-cap request still works (checked first: an aborted upload can poison the connection).
    const ok = await fetch(`http://127.0.0.1:${port}/`, {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "agent/card" }),
    });
    expect(await ok.text()).toContain("Sec Agent");

    const big = "x".repeat(4096);
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        const enc = new TextEncoder();
        c.enqueue(enc.encode(`{"jsonrpc":"2.0","id":1,"method":"agent/card","params":{"p":"`));
        c.enqueue(enc.encode(big));
        c.enqueue(enc.encode(`"}}`));
        c.close();
      },
    });
    const res = await fetch(`http://127.0.0.1:${port}/`, {
      method: "POST",
      body: stream,
      // @ts-expect-error duplex is required by undici/bun for streamed bodies
      duplex: "half",
    });
    expect(res.status).toBe(413);
  });
});

describe("A2A task store is bounded", () => {
  it("RED-ON-CUT: evicts the oldest task beyond maxTasks", async () => {
    const mk = (id: string): A2ATask => ({
      id,
      contextId: id,
      status: { state: "completed", timestamp: "t" },
      createdAt: "t",
      updatedAt: "t",
    });
    const found = await Effect.runPromise(
      Effect.gen(function* () {
        const s = yield* A2AServer;
        for (const id of ["t1", "t2", "t3"]) yield* s.setTask(mk(id));
        const results: boolean[] = [];
        for (const id of ["t1", "t2", "t3"]) {
          results.push(yield* s.getTask(id).pipe(Effect.as(true), Effect.orElseSucceed(() => false)));
        }
        return results;
      }).pipe(Effect.provide(createA2AServer(card, { maxTasks: 2 }))),
    );
    expect(found).toEqual([false, true, true]);
  });
});

describe("A2A discovery egress", () => {
  it("RED-ON-CUT: discovery does not follow a redirect to another host", async () => {
    const target = Bun.serve({ port: 0, fetch: () => Response.json(card) });
    const redirector = Bun.serve({
      port: 0,
      fetch: () => Response.redirect(`http://127.0.0.1:${target.port}/.well-known/agent.json`, 302),
    });
    servers.push(target, redirector);
    const exit = await Effect.runPromiseExit(discoverAgent(`http://127.0.0.1:${redirector.port}`));
    expect(exit._tag).toBe("Failure");
  });

  it("RED-ON-CUT: getAgentCard refuses cloud-metadata targets and strict egress refuses loopback", async () => {
    const run = (url: string, egress?: { strictEgress: boolean }) =>
      Effect.runPromiseExit(
        Effect.gen(function* () {
          const c = yield* A2AClient;
          return yield* c.getAgentCard(url);
        }).pipe(Effect.provide(createA2AClient({ baseUrl: "http://127.0.0.1:1", egress }))),
      );
    expect((await run("http://169.254.169.254"))._tag).toBe("Failure");
    expect((await run("http://[::ffff:a9fe:a9fe]"))._tag).toBe("Failure");
    const local = Bun.serve({ port: 0, fetch: () => Response.json(card) });
    servers.push(local);
    expect((await run(`http://127.0.0.1:${local.port}`))._tag).toBe("Success");
    expect((await run(`http://127.0.0.1:${local.port}`, { strictEgress: true }))._tag).toBe("Failure");
  });

  it("getAgentCard does not follow redirects", async () => {
    const target = Bun.serve({ port: 0, fetch: () => Response.json(card) });
    const redirector = Bun.serve({ port: 0, fetch: () => Response.redirect(`http://127.0.0.1:${target.port}/`, 302) });
    servers.push(target, redirector);
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const c = yield* A2AClient;
        return yield* c.getAgentCard(`http://127.0.0.1:${redirector.port}`);
      }).pipe(Effect.provide(createA2AClient({ baseUrl: "http://127.0.0.1:1" }))),
    );
    expect(exit._tag).toBe("Failure");
  });
});

describe("A2A client RPC does not follow redirects", () => {
  it("RED-ON-CUT: a 302 from the RPC endpoint is not followed (X-API-Key must not leak to the target)", async () => {
    let targetHit = false;
    let leakedKey: string | null = null;
    const target = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: (req) => {
        targetHit = true;
        leakedKey = req.headers.get("x-api-key");
        return Response.json({ jsonrpc: "2.0", id: "x", result: {} });
      },
    });
    const redirector = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () => new Response(null, { status: 302, headers: { Location: `http://127.0.0.1:${target.port}/` } }),
    });
    servers.push(target, redirector);

    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const client = yield* A2AClient;
        return yield* client.getTask({ id: "t1" });
      }).pipe(
        Effect.provide(
          createA2AClient({
            baseUrl: `http://127.0.0.1:${redirector.port}/`,
            auth: { type: "apiKey", apiKey: "secret-key" },
          }),
        ),
      ),
    );
    expect(exit._tag).toBe("Failure");
    expect(targetHit).toBe(false);
    expect(leakedKey).toBeNull();
  });
});
