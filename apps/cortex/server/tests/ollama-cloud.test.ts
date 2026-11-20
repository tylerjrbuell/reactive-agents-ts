// Run: bun run repo test apps/cortex/server/tests/ollama-cloud.test.ts
//
// Ollama Cloud in Cortex: the saved endpoint reaches the framework (OLLAMA_ENDPOINT), the saved
// key reaches the builder's provider config only for a non-loopback endpoint, the model list
// sends the bearer to the configured host only, and a rejected key reads plainly. No real key
// and no real host: a Bun stub server and injected fetches.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveOllamaEndpoint } from "@reactive-agents/llm-provider";
import {
  applyOllamaEndpoint,
  bearerFetch,
  installOllamaEndpointStore,
  isLoopbackEndpoint,
  isOllamaAuthFailure,
  normalizeOllamaEndpoint,
  OLLAMA_AUTH_MESSAGE,
  OLLAMA_CLOUD_ENDPOINT,
  OllamaEndpointStore,
  ollamaListKey,
} from "../services/ollama-cloud.js";
import { installProviderKeyStore, ProviderKeyStore, providerKeyForAgent, PROVIDER_KEYS_FILE } from "../services/provider-key-store.js";
import { cortexAgentBuilder } from "../services/build-cortex-agent.js";
import { buildModelsResponse, type ModelsDeps } from "../api/models.js";
import { providerKeysRouter } from "../api/provider-keys.js";
import { ollamaSettingsRouter } from "../api/ollama-settings.js";
import type { HostResolver } from "../outbound-url.js";

const KEY = "ollama-fake-key-0123456789abcdWXYZ";
let dir: string;
let store: ProviderKeyStore;
let endpoints: OllamaEndpointStore;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = { OLLAMA_ENDPOINT: process.env.OLLAMA_ENDPOINT, OLLAMA_HOST: process.env.OLLAMA_HOST, OLLAMA_API_KEY: process.env.OLLAMA_API_KEY };
  delete process.env.OLLAMA_ENDPOINT;
  delete process.env.OLLAMA_HOST;
  delete process.env.OLLAMA_API_KEY;
  dir = mkdtempSync(join(tmpdir(), "cortex-ollama-"));
  store = new ProviderKeyStore({ dir, env: {}, now: () => 1_000 });
  endpoints = new OllamaEndpointStore(dir);
  installProviderKeyStore(store);
  installOllamaEndpointStore(endpoints);
});
afterEach(() => {
  installOllamaEndpointStore(null);
  installProviderKeyStore(null);
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(dir, { recursive: true, force: true });
});

/** The provider config the builder holds (private; the only observable of what reaches the adapter). */
const providerConfigOf = (b: unknown): { apiKey?: string } | undefined => (b as { _providerConfig?: { apiKey?: string } })._providerConfig;

describe("endpoint helpers", () => {
  it("normalizes to an http(s) URL without a trailing slash, or rejects", () => {
    expect(normalizeOllamaEndpoint("https://ollama.com/")).toBe("https://ollama.com");
    expect(normalizeOllamaEndpoint("myhost:11434")).toBe("http://myhost:11434");
    expect(normalizeOllamaEndpoint("ftp://x")).toBeUndefined();
    expect(normalizeOllamaEndpoint("  ")).toBeUndefined();
  });
  it("knows loopback hosts", () => {
    expect(["http://localhost:11434", "http://127.0.0.1:11434", "http://[::1]:11434"].every(isLoopbackEndpoint)).toBe(true);
    expect(isLoopbackEndpoint(OLLAMA_CLOUD_ENDPOINT)).toBe(false);
  });
  it("recognises an Ollama authentication failure", () => {
    expect(isOllamaAuthFailure("ollama request failed: unauthorized")).toBe(true);
    expect(isOllamaAuthFailure("ollama request failed: 401")).toBe(true);
    expect(isOllamaAuthFailure("anthropic request failed: 401")).toBe(false);
    expect(isOllamaAuthFailure("ollama request failed: model not found")).toBe(false);
  });
});

describe("the saved endpoint reaches the framework", () => {
  it("a saved Ollama Cloud endpoint is what the framework resolves for runs, chat and probes", () => {
    process.env.OLLAMA_HOST = "http://env-host:11434";
    expect(resolveOllamaEndpoint()).toBe("http://env-host:11434");
    endpoints.set(OLLAMA_CLOUD_ENDPOINT);
    applyOllamaEndpoint();
    expect(resolveOllamaEndpoint()).toBe(OLLAMA_CLOUD_ENDPOINT);
  });
  it("clearing it restores what the server started with", () => {
    process.env.OLLAMA_HOST = "http://env-host:11434";
    endpoints.set(OLLAMA_CLOUD_ENDPOINT);
    applyOllamaEndpoint();
    endpoints.set(undefined);
    applyOllamaEndpoint();
    expect(resolveOllamaEndpoint()).toBe("http://env-host:11434");
  });
});

describe("the saved key reaches the builder's provider config", () => {
  it("is passed to .withProvider('ollama') for Ollama Cloud", async () => {
    store.set("ollama", KEY);
    endpoints.set(OLLAMA_CLOUD_ENDPOINT);
    applyOllamaEndpoint();
    const b = await cortexAgentBuilder({ provider: "ollama", model: "gpt-oss:120b" });
    expect(providerConfigOf(b)?.apiKey).toBe(KEY);
    expect(JSON.stringify(b.toConfig())).not.toContain(KEY);
  });

  it("is withheld while the endpoint is this machine", async () => {
    store.set("ollama", KEY);
    expect(providerKeyForAgent("ollama")).toBeUndefined();
    expect(providerConfigOf(await cortexAgentBuilder({ provider: "ollama", model: "qwen3:8b" }))?.apiKey).toBeUndefined();
    endpoints.set("http://localhost:11434");
    applyOllamaEndpoint();
    expect(providerKeyForAgent("ollama")).toBeUndefined();
  });

  it("another provider's key is not affected by the Ollama endpoint", () => {
    store.set("openai", KEY);
    expect(providerKeyForAgent("openai")).toBe(KEY);
  });
});

describe("model list", () => {
  const cloud = () => {
    endpoints.set(OLLAMA_CLOUD_ENDPOINT);
    applyOllamaEndpoint();
  };
  /** A recording inner fetch; the deps.resolve below calls the fetch it was given. */
  const harness = (status = 200) => {
    const seen: { url: string; auth: string | null }[] = [];
    const inner = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      seen.push({ url, auth: new Headers(init?.headers).get("authorization") });
      return new Response(JSON.stringify({ models: [{ name: "gpt-oss:120b" }] }), { status, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    const deps: ModelsDeps = {
      fetch: inner,
      storedKeys: { forAgent: (p) => providerKeyForAgent(p), has: () => false },
      resolve: async (_p, opts) => {
        await (opts.fetch ?? fetch)(`${opts.baseUrl}/api/tags`);
        // The shape the framework returns, trimmed to what Cortex reads.
        const ok = { models: [{ id: "gpt-oss:120b", label: "gpt-oss:120b", source: "live", supportsThinking: null }], live: true };
        const failed = { models: [], live: false, error: { reason: "http", message: `HTTP ${status} from ollama` } };
        return (status === 200 ? ok : failed) as unknown as Awaited<ReturnType<ModelsDeps["resolve"]>>;
      },
    };
    return { seen, deps };
  };

  it("sends the bearer to the configured Ollama Cloud host and shows its models", async () => {
    cloud();
    store.set("ollama", KEY);
    const h = harness();
    const r = await buildModelsResponse("ollama", undefined, h.deps);
    expect(r.live).toBe(true);
    expect(h.seen[0]).toEqual({ url: `${OLLAMA_CLOUD_ENDPOINT}/api/tags`, auth: `Bearer ${KEY}` });
  });

  it("falls back to OLLAMA_API_KEY from the environment", async () => {
    cloud();
    process.env.OLLAMA_API_KEY = "env-fake-key-abcdef123456";
    const h = harness();
    await buildModelsResponse("ollama", undefined, h.deps);
    expect(h.seen[0]?.auth).toBe("Bearer env-fake-key-abcdef123456");
  });

  it("never sends the key to a different host, even if the caller asks for it", async () => {
    cloud();
    store.set("ollama", KEY);
    const h = harness();
    await buildModelsResponse("ollama", "https://evil.example", h.deps);
    expect(h.seen.every((s) => s.auth === null)).toBe(true);
  });

  it("sends no key to a local server", async () => {
    store.set("ollama", KEY);
    const h = harness();
    await buildModelsResponse("ollama", undefined, h.deps);
    expect(h.seen.every((s) => s.auth === null)).toBe(true);
    expect(ollamaListKey("http://localhost:11434", KEY)).toBeUndefined();
  });

  it("a 401 reads 'Ollama Cloud key missing or invalid'", async () => {
    cloud();
    const r = await buildModelsResponse("ollama", undefined, harness(401).deps);
    expect(r.live).toBe(false);
    expect(r.error).toEqual({ reason: "unauthorized", message: OLLAMA_AUTH_MESSAGE });
    expect(OLLAMA_AUTH_MESSAGE.startsWith("Ollama Cloud key missing or invalid")).toBe(true);
  });
});

describe("bearerFetch against a stub server", () => {
  it("adds the bearer only for the configured origin (real HTTP, fake key)", async () => {
    const seen: (string | null)[] = [];
    const a = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: (req) => (seen.push(req.headers.get("authorization")), new Response("{}")) });
    const b = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: (req) => (seen.push(req.headers.get("authorization")), new Response("{}")) });
    try {
      const f = bearerFetch(`http://127.0.0.1:${a.port}`, KEY);
      await f(`http://127.0.0.1:${a.port}/api/tags`);
      await f(`http://127.0.0.1:${b.port}/api/tags`);
      expect(seen).toEqual([`Bearer ${KEY}`, null]);
    } finally {
      a.stop(true);
      b.stop(true);
    }
  });
});

describe("Settings API", () => {
  // Hermetic DNS for the outbound-URL check: the system resolver would look up the real
  // Ollama Cloud host (network-dependent; stalls under load).
  const publicDns: HostResolver = async () => ["93.184.216.34"];
  const settings = () => ollamaSettingsRouter(endpoints, publicDns);
  const send = (a: ReturnType<typeof settings>, method: string, body?: unknown) =>
    a.handle(
      new Request("http://localhost/api/settings/ollama", {
        method,
        headers: body === undefined ? {} : { "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );

  it("saves the Ollama Cloud preset and reports it; null clears it", async () => {
    const a = settings();
    const put = (await (await send(a, "PUT", { endpoint: OLLAMA_CLOUD_ENDPOINT })).json()) as Record<string, unknown>;
    expect(put).toMatchObject({ endpoint: OLLAMA_CLOUD_ENDPOINT, effective: OLLAMA_CLOUD_ENDPOINT, cloud: true, local: false });
    expect(resolveOllamaEndpoint()).toBe(OLLAMA_CLOUD_ENDPOINT);
    const cleared = (await (await send(a, "PUT", { endpoint: null })).json()) as Record<string, unknown>;
    expect(cleared).toMatchObject({ endpoint: null, cloud: false, local: true });
  });

  it("refuses a non-http endpoint", async () => {
    const res = await send(settings(), "PUT", { endpoint: "ftp://nope" });
    expect(res.status).toBe(400);
    expect(endpoints.get()).toBeUndefined();
  });
});

describe("Ollama key API", () => {
  const call = (a: ReturnType<typeof providerKeysRouter>, method: string, path: string, body?: unknown) =>
    a.handle(
      new Request(`http://localhost/api/settings/keys${path}`, {
        method,
        headers: body === undefined ? {} : { "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );

  it("is a keyed entry that never echoes the key", async () => {
    const a = providerKeysRouter(store);
    expect(await (await call(a, "PUT", "/ollama", { apiKey: KEY })).text()).not.toContain(KEY);
    const list = await (await call(a, "GET", "/")).text();
    expect(list).not.toContain(KEY);
    expect(list).toContain('"provider":"ollama"');
    expect(list).toContain("OLLAMA_API_KEY");
    expect(readFileSync(join(dir, PROVIDER_KEYS_FILE), "utf8")).not.toContain(KEY);
  });

  it("Test lists models on the configured host with the typed key and reads a 401 plainly", async () => {
    endpoints.set(OLLAMA_CLOUD_ENDPOINT);
    applyOllamaEndpoint();
    let auth: string | null = null;
    const ok = providerKeysRouter(store, async (_p, opts) => {
      await (opts.fetch ?? fetch)(`${opts.baseUrl}/api/tags`).catch(() => undefined);
      return { ok: true, count: 4 };
    });
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      auth = new Headers(init?.headers).get("authorization");
      return new Response("{}");
    }) as unknown as typeof fetch;
    try {
      const good = (await (await call(ok, "POST", "/ollama/test", { apiKey: KEY })).json()) as { ok: boolean; models?: number };
      expect(good).toMatchObject({ ok: true, models: 4 });
      expect(auth as string | null).toBe(`Bearer ${KEY}`);
    } finally {
      globalThis.fetch = realFetch;
    }
    const bad = providerKeysRouter(store, async () => ({ ok: false, message: `HTTP 401 for ${KEY}` }));
    const text = await (await call(bad, "POST", "/ollama/test", { apiKey: KEY })).text();
    expect(text).not.toContain(KEY);
    expect(text).toContain("Ollama Cloud key missing or invalid");
  });

  it("Test on a local endpoint says no key is needed, without calling out", async () => {
    let called = false;
    const a = providerKeysRouter(store, async () => ((called = true), { ok: true, count: 1 }));
    const r = (await (await call(a, "POST", "/ollama/test", { apiKey: KEY })).json()) as { ok: boolean; error?: string };
    expect(r.ok).toBe(false);
    expect(r.error).toContain("needs no key");
    expect(called).toBe(false);
  });
});
