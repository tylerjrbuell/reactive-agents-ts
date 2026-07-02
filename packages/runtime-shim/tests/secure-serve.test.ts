// Run: bun test packages/runtime-shim/tests/secure-serve.test.ts --timeout 15000
//
// F4 — agent servers (A2A, `rax serve`, judge) bound 0.0.0.0 with no auth and
// ran attacker prompts on the operator's credentials. secureServe is the
// fail-closed ingress helper: loopback by default, a non-loopback bind without
// a token is refused, a token (when set) is enforced, and request bodies are
// size-capped before the handler runs.
import { describe, test, expect, afterEach } from "bun:test";
import { secureServe } from "../src/secure-serve.js";
import type { ServerLike } from "../src/types.js";

let server: ServerLike | undefined;
afterEach(() => {
  server?.stop(true);
  server = undefined;
});

const ok = () => new Response("ok");

describe("F4 — secureServe", () => {
  test("defaults to loopback (127.0.0.1)", async () => {
    server = await secureServe({ port: 0, fetch: ok });
    expect(server.hostname).toBe("127.0.0.1");
  }, 15000);

  test("refuses a non-loopback bind without a token (fail-closed)", async () => {
    await expect(
      secureServe({ port: 0, hostname: "0.0.0.0", fetch: ok }),
    ).rejects.toThrow(/token/i);
  }, 15000);

  test("allows a non-loopback bind when a token is provided", async () => {
    server = await secureServe({ port: 0, hostname: "0.0.0.0", token: "s3cret", fetch: ok });
    expect(server.hostname).toBe("0.0.0.0");
  }, 15000);

  test("loopback without a token is allowed (local trust)", async () => {
    server = await secureServe({ port: 0, fetch: ok });
    const res = await fetch(`http://127.0.0.1:${server.port}/`);
    expect(res.status).toBe(200);
  }, 15000);

  test("rejects a request with no bearer token when a token is configured", async () => {
    server = await secureServe({ port: 0, token: "s3cret", fetch: ok });
    const res = await fetch(`http://127.0.0.1:${server.port}/`);
    expect(res.status).toBe(401);
  }, 15000);

  test("rejects a wrong bearer token", async () => {
    server = await secureServe({ port: 0, token: "s3cret", fetch: ok });
    const res = await fetch(`http://127.0.0.1:${server.port}/`, {
      headers: { Authorization: "Bearer wrong" },
    });
    expect(res.status).toBe(401);
  }, 15000);

  test("accepts the correct bearer token", async () => {
    server = await secureServe({ port: 0, token: "s3cret", fetch: ok });
    const res = await fetch(`http://127.0.0.1:${server.port}/`, {
      headers: { Authorization: "Bearer s3cret" },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  }, 15000);

  test("rejects a body over the size cap with 413 before the handler runs", async () => {
    let handlerRan = false;
    server = await secureServe({
      port: 0,
      maxBodyBytes: 16,
      fetch: () => {
        handlerRan = true;
        return new Response("ok");
      },
    });
    const res = await fetch(`http://127.0.0.1:${server.port}/`, {
      method: "POST",
      body: "x".repeat(1000),
    });
    expect(res.status).toBe(413);
    expect(handlerRan).toBe(false);
  }, 15000);
});
