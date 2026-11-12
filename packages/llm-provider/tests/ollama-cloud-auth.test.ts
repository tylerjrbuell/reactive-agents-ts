// Run: bun test packages/llm-provider/tests/ollama-cloud-auth.test.ts --timeout 20000
//
// Ollama Cloud rejects unauthenticated requests. Every Ollama call site must send
// the Bearer key to the resolved endpoint: the build pre-flight (/api/tags), the
// capability probe (/api/show), model discovery (/api/tags) and the adapter
// (/api/chat). A local stub HTTP server on 127.0.0.1 records what each site sends.
// No real hosts, no real keys.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { createServer, type Server } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { LLMService } from "../src/llm-service.js";
import { createLLMProviderLayer } from "../src/runtime.js";
import { checkOllamaConnection, resolveOllamaTarget } from "../src/ollama-endpoint.js";
import { primeCapability } from "../src/capability-prime.js";
import { clearModelDiscoveryCache, listProviderModels } from "../src/model-discovery.js";
import { _resetProbeCacheForTesting } from "../src/providers/local-probe.js";
import { setCapabilityStoreDirForTesting } from "../src/capability-store.js";
import { OllamaAuthError } from "../src/errors.js";

interface Seen {
  readonly path: string;
  readonly authorization: string | undefined;
}

const KEY = "stub-cloud-key-123";
const seen: Seen[] = [];
let server: Server;
let base: string;
let requireKey = true;

beforeAll(async () => {
  server = createServer((req, res) => {
    const authorization = req.headers.authorization;
    const url = (req.url ?? "").split("?")[0] ?? "";
    seen.push({ path: url, authorization });
    req.resume();
    req.on("end", () => {
      if (requireKey && authorization !== `Bearer ${KEY}`) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      if (url === "/api/tags") {
        res.end(JSON.stringify({ models: [{ name: "stub-model:cloud", details: {} }] }));
      } else if (url === "/api/show") {
        res.end(
          JSON.stringify({
            capabilities: ["completion", "tools"],
            details: { family: "stub", parameter_size: "8B" },
            model_info: { "stub.context_length": 32768 },
            template: "",
          }),
        );
      } else if (url === "/api/chat") {
        res.end(
          JSON.stringify({
            model: "stub-model:cloud",
            created_at: new Date().toISOString(),
            message: { role: "assistant", content: "hello from stub" },
            done: true,
            done_reason: "stop",
            prompt_eval_count: 3,
            eval_count: 4,
          }),
        );
      } else {
        res.end("{}");
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (addr === null || typeof addr === "string") throw new Error("stub server has no port");
  base = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const SAVED = ["OLLAMA_ENDPOINT", "OLLAMA_HOST", "OLLAMA_BASE", "OLLAMA_API_KEY"] as const;
const saved: Partial<Record<(typeof SAVED)[number], string>> = {};
let storeDir: string;

beforeEach(() => {
  for (const k of SAVED) {
    const v = process.env[k];
    if (v !== undefined) saved[k] = v;
    delete process.env[k];
  }
  seen.length = 0;
  requireKey = true;
  storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ra-ollama-cloud-"));
  setCapabilityStoreDirForTesting(storeDir);
  _resetProbeCacheForTesting();
  clearModelDiscoveryCache();
});

afterEach(() => {
  for (const k of SAVED) {
    const v = saved[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  _resetProbeCacheForTesting();
  setCapabilityStoreDirForTesting(null);
  fs.rmSync(storeDir, { recursive: true, force: true });
});

const authFor = (p: string): ReadonlyArray<string | undefined> =>
  seen.filter((s) => s.path === p).map((s) => s.authorization);

describe("resolveOllamaTarget", () => {
  it("explicit key wins over OLLAMA_API_KEY; env is the fallback; none means no headers", () => {
    process.env.OLLAMA_API_KEY = "env-key";
    expect(resolveOllamaTarget({ apiKey: "cfg-key" }).headers).toEqual({ Authorization: "Bearer cfg-key" });
    expect(resolveOllamaTarget().headers).toEqual({ Authorization: "Bearer env-key" });
    delete process.env.OLLAMA_API_KEY;
    expect(resolveOllamaTarget().headers).toEqual({});
  });

  it("explicit baseUrl wins over env endpoint", () => {
    process.env.OLLAMA_ENDPOINT = "http://env-host:1";
    expect(resolveOllamaTarget({ baseUrl: "http://cfg-host:2/" }).endpoint).toBe("http://cfg-host:2");
  });
});

describe("pre-flight connection check", () => {
  it("sends the Bearer key on GET /api/tags", async () => {
    const r = await checkOllamaConnection({ baseUrl: base, apiKey: KEY });
    expect(r.ok).toBe(true);
    expect(authFor("/api/tags")).toEqual([`Bearer ${KEY}`]);
  });

  it("falls back to OLLAMA_API_KEY", async () => {
    process.env.OLLAMA_API_KEY = KEY;
    expect((await checkOllamaConnection({ baseUrl: base })).ok).toBe(true);
    expect(authFor("/api/tags")).toEqual([`Bearer ${KEY}`]);
  });

  it("401 without a key yields a typed OllamaAuthError with status and no key in the message", async () => {
    const r = await checkOllamaConnection({ baseUrl: base });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBeInstanceOf(OllamaAuthError);
    expect(r.error?._tag).toBe("OllamaAuthError");
    expect(r.error?.status).toBe(401);
    expect(r.error?.keyProvided).toBe(false);
    expect(r.message).toContain("OLLAMA_API_KEY");
  });

  it("401 with a wrong key says the key was rejected and never echoes it", async () => {
    const r = await checkOllamaConnection({ baseUrl: base, apiKey: "wrong-secret" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error?.keyProvided).toBe(true);
    expect(r.message).not.toContain("wrong-secret");
  });
});

describe("capability probe", () => {
  it("sends the Bearer key on POST /api/show", async () => {
    await primeCapability("ollama", "stub-model:cloud", { endpoint: base, apiKey: KEY });
    expect(authFor("/api/show")).toEqual([`Bearer ${KEY}`]);
  });

  it("falls back to OLLAMA_API_KEY", async () => {
    process.env.OLLAMA_API_KEY = KEY;
    await primeCapability("ollama", "stub-model:cloud", { endpoint: base });
    expect(authFor("/api/show")).toEqual([`Bearer ${KEY}`]);
  });
});

describe("model discovery", () => {
  it("sends the Bearer key on GET /api/tags to the given baseUrl", async () => {
    const models = await Effect.runPromise(listProviderModels("ollama", { baseUrl: base, apiKey: KEY }));
    expect(models.map((m) => m.id)).toContain("stub-model:cloud");
    expect(authFor("/api/tags")).toEqual([`Bearer ${KEY}`]);
  });

  it("does not send OLLAMA_API_KEY to a baseUrl other than the env-resolved endpoint", async () => {
    process.env.OLLAMA_API_KEY = KEY;
    requireKey = false;
    await Effect.runPromise(listProviderModels("ollama", { baseUrl: base }));
    expect(authFor("/api/tags")).toEqual([undefined]);
  });

  it("sends OLLAMA_API_KEY to the env-resolved endpoint", async () => {
    process.env.OLLAMA_API_KEY = KEY;
    process.env.OLLAMA_ENDPOINT = base;
    await Effect.runPromise(listProviderModels("ollama", {}));
    expect(authFor("/api/tags")).toEqual([`Bearer ${KEY}`]);
  });
});

describe("adapter honours providerConfig.baseUrl and apiKey", () => {
  it("complete() sends the key to /api/show and /api/chat on the per-agent baseUrl", async () => {
    // A different env endpoint proves providerConfig.baseUrl takes precedence.
    process.env.OLLAMA_ENDPOINT = "http://127.0.0.1:1";
    const layer = createLLMProviderLayer("ollama", undefined, "stub-model:cloud", {
      baseUrl: base,
      apiKey: KEY,
    });
    const res = await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.complete({ messages: [{ role: "user", content: "hi" }] });
      }).pipe(Effect.provide(layer)),
    );
    expect(res.content).toBe("hello from stub");
    expect(authFor("/api/chat")).toEqual([`Bearer ${KEY}`]);
    expect(authFor("/api/show").every((a) => a === `Bearer ${KEY}`)).toBe(true);
    expect(authFor("/api/show").length).toBeGreaterThan(0);
  });
});
