// Run: bun run repo test packages/a2a/tests/params-validation.test.ts
// Security audit M7: JSON-RPC params are schema-validated before dispatch (-32602).
import { afterEach, describe, expect, it } from "bun:test";
import { Effect, Layer } from "effect";
import { A2AHttpServer, createA2AHttpServer } from "../src/server/http-server.js";
import { createA2AServer } from "../src/server/a2a-server.js";
import type { AgentCard } from "../src/types.js";

const card: AgentCard = {
  name: "Params Agent",
  version: "0.1.0",
  url: "http://localhost:0",
  provider: { organization: "Test" },
  capabilities: { streaming: false },
};

const stops: Array<() => void> = [];
afterEach(() => {
  while (stops.length) stops.pop()?.();
});

const boot = async (): Promise<number> => {
  const layer = createA2AHttpServer(0).pipe(Layer.provide(createA2AServer(card)));
  const { port, stop } = await Effect.runPromise(
    Effect.gen(function* () {
      const svc = yield* A2AHttpServer;
      const port = yield* svc.start();
      return { port, stop: () => Effect.runPromise(svc.stop()) };
    }).pipe(Effect.provide(layer)),
  );
  stops.push(() => void stop());
  return port;
};

const rpc = async (port: number, method: string, params: unknown) => {
  const res = await fetch(`http://127.0.0.1:${port}/`, {
    method: "POST",
    body: JSON.stringify({ jsonrpc: "2.0", id: 7, method, params }),
  });
  return (await res.json()) as { id: unknown; error?: { code: number; message: string }; result?: unknown };
};

describe("A2A JSON-RPC params validation", () => {
  it("RED-ON-CUT: malformed message/send params get -32602", async () => {
    const port = await boot();
    for (const params of [undefined, null, "x", { message: "not-an-object" }, { message: { role: "user" } }]) {
      const body = await rpc(port, "message/send", params);
      expect(body.error?.code).toBe(-32602);
      expect(body.id).toBe(7);
    }
  });

  it("RED-ON-CUT: tasks/get and tasks/cancel need a string id; message/stream is validated", async () => {
    const port = await boot();
    expect((await rpc(port, "tasks/get", { id: 5 })).error?.code).toBe(-32602);
    expect((await rpc(port, "tasks/get", {})).error?.code).toBe(-32602);
    expect((await rpc(port, "tasks/cancel", null)).error?.code).toBe(-32602);
    expect((await rpc(port, "message/stream", { message: 1 })).error?.code).toBe(-32602);
  });

  it("valid params still reach the handler (task-not-found is not -32602)", async () => {
    const port = await boot();
    const body = await rpc(port, "tasks/get", { id: "nope" });
    expect(body.error?.code).toBe(-32000);
  });

  it("methods without params are untouched", async () => {
    const port = await boot();
    const body = await rpc(port, "agent/card", undefined);
    expect(body.error).toBeUndefined();
  });
});
