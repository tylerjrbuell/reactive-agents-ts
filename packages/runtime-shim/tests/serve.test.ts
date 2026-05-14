import { test, expect } from "bun:test";
import { serve } from "../src/index.js";

test("serve creates HTTP server and handles request", async () => {
  const server = await serve({
    port: 0,  // any available port
    fetch: (req) => new Response("ok " + new URL(req.url).pathname),
  });

  expect(server.port).toBeGreaterThan(0);

  const res = await fetch(`${server.url}test`);
  const body = await res.text();
  expect(body).toBe("ok /test");

  server.stop();
});

test("serve passes headers through", async () => {
  const server = await serve({
    port: 0,
    fetch: (req) => {
      const auth = req.headers.get("x-auth");
      return new Response(`auth: ${auth ?? "none"}`);
    },
  });

  const res = await fetch(`${server.url}`, { headers: { "x-auth": "secret" } });
  const body = await res.text();
  expect(body).toBe("auth: secret");

  server.stop();
});
