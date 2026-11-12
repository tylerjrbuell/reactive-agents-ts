// Run: bun test packages/runtime/tests/seam-ollama-cloud-preflight.test.ts --timeout 20000
//
// Ollama Cloud rejects unauthenticated requests. The build pre-flight used a
// bare fetch, so a keyed cloud agent failed to build with "HTTP 401". It now
// sends the per-agent providerConfig key (checkOllamaConnection).
//
// Stub server on 127.0.0.1 (ephemeral port), no real keys.
//   O1 build succeeds with the right key against a 401-without-key stub.
//   O2 a wrong key fails the build with a clear message that never leaks the key.
//   O3 no key fails the build and says an API key is required.
//
// Red-on-cut: revert validateProviderConnection to an unauthenticated fetch -> O1 fails.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { ReactiveAgents } from "../src/builder.js";

const GOOD_KEY = "stub-good-key-123";
const WRONG_KEY = "stub-wrong-key-999";

let server: Server;
let baseUrl = "";
let priorEnvKey: string | undefined;

beforeAll(async () => {
  priorEnvKey = process.env.OLLAMA_API_KEY;
  delete process.env.OLLAMA_API_KEY;
  server = createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${GOOD_KEY}`) {
      res.statusCode = 401;
      res.end("unauthorized");
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ models: [] }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  if (priorEnvKey !== undefined) process.env.OLLAMA_API_KEY = priorEnvKey;
  await new Promise<void>((r) => server.close(() => r()));
});

const build = (apiKey?: string) =>
  ReactiveAgents.create()
    .withName("cloud-preflight")
    .withProvider("ollama", { baseUrl, ...(apiKey !== undefined ? { apiKey } : {}) } as never)
    .withModel("stub-model")
    .build();

describe("ollama cloud build pre-flight", () => {
  it("O1 builds with the right key", async () => {
    await expect(build(GOOD_KEY)).resolves.toBeDefined();
  });

  it("O2 wrong key fails clearly without leaking the key", async () => {
    const err = await build(WRONG_KEY).then(
      () => undefined,
      (e: unknown) => e as Error,
    );
    expect(err?.message).toContain("Provider connection failed");
    expect(err?.message).toContain("rejected the API key");
    expect(err?.message).not.toContain(WRONG_KEY);
  });

  it("O3 no key fails and says a key is required", async () => {
    const err = await build().then(
      () => undefined,
      (e: unknown) => e as Error,
    );
    expect(err?.message).toContain("requires an API key");
  });
});
