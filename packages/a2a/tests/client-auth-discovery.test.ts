// Run: bun run repo test packages/a2a/tests/client-auth-discovery.test.ts
// Client apiKey must authenticate against the real server; discovery fetch is bounded and pinned.
import { afterEach, describe, expect, it } from "bun:test";
import { Effect, Layer } from "effect";
import { A2AClient, createA2AClient } from "../src/client/a2a-client.js";
import { discoverAgent } from "../src/client/discovery.js";
import { A2AHttpServer, createA2AHttpServer } from "../src/server/http-server.js";
import { createA2AServer } from "../src/server/a2a-server.js";
import type { AgentCard } from "../src/types.js";

const stops: Array<() => void> = [];
afterEach(() => {
  while (stops.length) stops.pop()?.();
});

const card: AgentCard = {
  name: "Auth Agent",
  version: "0.1.0",
  url: "http://localhost:0",
  provider: { organization: "Test" },
  capabilities: { streaming: false },
};

const startAuthed = async (token: string): Promise<string> => {
  const layer = createA2AHttpServer(0, undefined, undefined, { token }).pipe(Layer.provide(createA2AServer(card)));
  const { port, stop } = await Effect.runPromise(
    Effect.gen(function* () {
      const svc = yield* A2AHttpServer;
      const port = yield* svc.start();
      return { port, stop: () => Effect.runPromise(svc.stop()) };
    }).pipe(Effect.provide(layer)),
  );
  stops.push(() => void stop());
  return `http://127.0.0.1:${port}`;
};

const getTaskExit = (auth: { type: "bearer" | "apiKey"; token?: string; apiKey?: string }, baseUrl: string) =>
  Effect.runPromiseExit(
    Effect.gen(function* () {
      const c = yield* A2AClient;
      return yield* c.getTask({ id: "nope" });
    }).pipe(Effect.provide(createA2AClient({ baseUrl, auth }))),
  );

/** An authed call reaches the handler and fails with its task-not-found error (echoes the id "nope"); a 401 body is not JSON-RPC. */
const reachedHandler = (exit: Awaited<ReturnType<typeof getTaskExit>>): boolean =>
  exit._tag === "Failure" && /nope/.test(String(exit.cause));

describe("A2A client apiKey auth", () => {
  it("RED-ON-CUT: apiKey authenticates against a token-protected server", async () => {
    const base = await startAuthed("s3cret");
    expect(reachedHandler(await getTaskExit({ type: "apiKey", apiKey: "s3cret" }, base))).toBe(true);
  });

  it("a wrong apiKey is still rejected (401)", async () => {
    const base = await startAuthed("s3cret");
    expect(reachedHandler(await getTaskExit({ type: "apiKey", apiKey: "wrong" }, base))).toBe(false);
  });

  it("bearer still works", async () => {
    const base = await startAuthed("s3cret");
    expect(reachedHandler(await getTaskExit({ type: "bearer", token: "s3cret" }, base))).toBe(true);
  });
});

describe("A2A discovery timeout", () => {
  it("RED-ON-CUT: a hung agent-card endpoint fails within the configured budget", async () => {
    const hung = Bun.serve({ port: 0, fetch: () => new Promise<Response>(() => undefined) });
    stops.push(() => void hung.stop(true));
    const started = Date.now();
    const exit = await Effect.runPromiseExit(discoverAgent(`http://127.0.0.1:${hung.port}`, { timeoutMs: 200 }));
    expect(exit._tag).toBe("Failure");
    expect(String(exit._tag === "Failure" ? exit.cause : "")).toContain("timed out after 200ms");
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it("getAgentCard honours egress.timeoutMs", async () => {
    const hung = Bun.serve({ port: 0, fetch: () => new Promise<Response>(() => undefined) });
    stops.push(() => void hung.stop(true));
    const base = `http://127.0.0.1:${hung.port}`;
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const c = yield* A2AClient;
        return yield* c.getAgentCard(base);
      }).pipe(Effect.provide(createA2AClient({ baseUrl: base, egress: { timeoutMs: 200 } }))),
    );
    expect(exit._tag).toBe("Failure");
  });

  it("discovery still resolves a healthy card and refuses redirects and metadata targets", async () => {
    const ok = Bun.serve({ port: 0, fetch: () => Response.json(card) });
    const redir = Bun.serve({ port: 0, fetch: () => Response.redirect(`http://127.0.0.1:${ok.port}/`, 307) });
    stops.push(() => void ok.stop(true), () => void redir.stop(true));
    const found = await Effect.runPromise(discoverAgent(`http://127.0.0.1:${ok.port}`));
    expect(found.name).toBe("Auth Agent");
    expect((await Effect.runPromiseExit(discoverAgent(`http://127.0.0.1:${redir.port}`)))._tag).toBe("Failure");
    expect((await Effect.runPromiseExit(discoverAgent("http://169.254.169.254/")))._tag).toBe("Failure");
  });
});
