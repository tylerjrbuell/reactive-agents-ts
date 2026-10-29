import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Effect } from "effect";
import {
  ModelDiscoveryError,
  clearModelDiscoveryCache,
  isChatModel,
  listProviderModels,
  resolveProviderModels,
} from "../src/model-discovery.js";

type Call = { url: string; headers: Record<string, string> };

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Injected fetch that records calls and answers from a router. */
const makeFetch = (route: (url: string, n: number) => Response | Promise<Response>) => {
  const calls: Call[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    calls.push({ url, headers });
    return route(url, calls.length);
  }) as typeof fetch;
  return { fn, calls };
};

const ids = (ms: readonly { id: string }[]) => ms.map((m) => m.id);
const run = <A>(e: Effect.Effect<A, ModelDiscoveryError>) => Effect.runPromise(Effect.either(e));

const ENV = [
  "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GOOGLE_API_KEY", "GROQ_API_KEY", "XAI_API_KEY",
  "LITELLM_API_KEY", "LITELLM_BASE_URL", "OLLAMA_ENDPOINT", "OLLAMA_HOST", "OLLAMA_BASE",
  "GROQ_BASE_URL", "XAI_BASE_URL",
] as const;
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k]; }
  clearModelDiscoveryCache();
});
afterEach(() => {
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

describe("listProviderModels per provider", () => {
  it("anthropic: x-api-key + version header, follows has_more/last_id", async () => {
    const { fn, calls } = makeFetch((url) =>
      url.includes("after_id=b")
        ? json({ data: [{ id: "c", display_name: "C" }], has_more: false, last_id: "c" })
        : json({ data: [{ id: "a", display_name: "A" }, { id: "b", display_name: "B" }], has_more: true, last_id: "b" }),
    );
    const r = await run(listProviderModels("anthropic", { apiKey: "sk-ant-1", fetch: fn }));
    expect(r._tag).toBe("Right");
    if (r._tag === "Right") expect(ids(r.right)).toEqual(["a", "b", "c"]);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url.startsWith("https://api.anthropic.com/v1/models")).toBe(true);
    expect(calls[0]!.headers["x-api-key"]).toBe("sk-ant-1");
    expect(calls[0]!.headers["anthropic-version"]).toBeDefined();
  });

  it("groq: skips models with active:false, keeps active:true and missing flag", async () => {
    const { fn } = makeFetch(() =>
      json({ object: "list", data: [
        { id: "llama-3.3-70b-versatile", active: true, context_window: 131072 },
        { id: "retired-model", active: false },
        { id: "no-flag-model" },
      ] }),
    );
    const r = await run(listProviderModels("groq", { apiKey: "gk", fetch: fn }));
    if (r._tag !== "Right") throw new Error("expected Right");
    expect(ids(r.right)).toEqual(["llama-3.3-70b-versatile", "no-flag-model"]);
  });

  it("openai: bearer, data[].id, non-chat ids filtered", async () => {
    const { fn, calls } = makeFetch(() =>
      json({ data: [
        { id: "gpt-4o" }, { id: "text-embedding-3-small" }, { id: "tts-1" }, { id: "whisper-1" },
        { id: "dall-e-3" }, { id: "omni-moderation-latest" }, { id: "gpt-4o-realtime-preview" }, { id: "o3-mini" },
      ] }),
    );
    const r = await run(listProviderModels("openai", { apiKey: "sk-o", fetch: fn }));
    if (r._tag !== "Right") throw new Error("expected Right");
    expect(ids(r.right)).toEqual(["gpt-4o", "o3-mini"]);
    expect(r.right.every((m) => m.source === "live")).toBe(true);
    expect(calls[0]!.url).toBe("https://api.openai.com/v1/models");
    expect(calls[0]!.headers["authorization"]).toBe("Bearer sk-o");
  });

  it("groq and xai use their own hosts", async () => {
    const g = makeFetch(() => json({ data: [{ id: "llama-3.3-70b-versatile" }, { id: "whisper-large-v3" }] }));
    const gr = await run(listProviderModels("groq", { apiKey: "gk", fetch: g.fn }));
    if (gr._tag !== "Right") throw new Error("expected Right");
    expect(ids(gr.right)).toEqual(["llama-3.3-70b-versatile"]);
    expect(g.calls[0]!.url).toBe("https://api.groq.com/openai/v1/models");
    const x = makeFetch(() => json({ data: [{ id: "grok-4" }] }));
    const xr = await run(listProviderModels("xai", { apiKey: "xk", fetch: x.fn }));
    if (xr._tag !== "Right") throw new Error("expected Right");
    expect(ids(xr.right)).toEqual(["grok-4"]);
    expect(x.calls[0]!.url).toBe("https://api.x.ai/v1/models");
  });

  it("gemini: x-goog-api-key header, keeps only generateContent, strips models/ prefix, paginates", async () => {
    const { fn, calls } = makeFetch((url) =>
      url.includes("pageToken=t2")
        ? json({ models: [{ name: "models/gemini-3-pro", displayName: "G3", supportedGenerationMethods: ["generateContent"] }] })
        : json({
            models: [
              { name: "models/gemini-2.5-flash", displayName: "Flash", inputTokenLimit: 1048576, supportedGenerationMethods: ["generateContent", "countTokens"] },
              { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] },
            ],
            nextPageToken: "t2",
          }),
    );
    const r = await run(listProviderModels("gemini", { apiKey: "gk-1", fetch: fn }));
    if (r._tag !== "Right") throw new Error("expected Right");
    expect(ids(r.right)).toEqual(["gemini-2.5-flash", "gemini-3-pro"]);
    expect(r.right[0]!.contextWindow).toBe(1048576);
    expect(calls[0]!.headers["x-goog-api-key"]).toBe("gk-1");
    expect(calls.every((c) => !c.url.includes("gk-1"))).toBe(true);
  });

  it("litellm: baseUrl, optional key", async () => {
    const { fn, calls } = makeFetch(() => json({ data: [{ id: "my-route" }] }));
    const r = await run(listProviderModels("litellm", { baseUrl: "http://proxy:4000/", fetch: fn }));
    if (r._tag !== "Right") throw new Error("expected Right");
    expect(ids(r.right)).toEqual(["my-route"]);
    expect(calls[0]!.url).toBe("http://proxy:4000/v1/models");
    expect(calls[0]!.headers["authorization"]).toBeUndefined();
    const k = makeFetch(() => json({ data: [{ id: "x" }] }));
    await run(listProviderModels("litellm", { baseUrl: "http://proxy:4000", apiKey: "lk", fetch: k.fn }));
    expect(k.calls[0]!.headers["authorization"]).toBe("Bearer lk");
  });

  it("litellm: env key never goes to a caller-named host; explicit key does", async () => {
    process.env.LITELLM_API_KEY = "env-secret";
    process.env.LITELLM_BASE_URL = "http://configured:4000";
    const a = makeFetch(() => json({ data: [{ id: "x" }] }));
    await run(listProviderModels("litellm", { baseUrl: "https://attacker.example", fetch: a.fn }));
    expect(a.calls[0]!.headers["authorization"]).toBeUndefined();
    clearModelDiscoveryCache();
    const b = makeFetch(() => json({ data: [{ id: "x" }] }));
    await run(listProviderModels("litellm", { baseUrl: "https://other.example", apiKey: "explicit", fetch: b.fn }));
    expect(b.calls[0]!.headers["authorization"]).toBe("Bearer explicit");
    clearModelDiscoveryCache();
    const c = makeFetch(() => json({ data: [{ id: "x" }] }));
    await run(listProviderModels("litellm", { fetch: c.fn }));
    expect(c.calls[0]!.headers["authorization"]).toBe("Bearer env-secret");
    clearModelDiscoveryCache();
    const d = makeFetch(() => json({ data: [{ id: "x" }] }));
    await run(listProviderModels("litellm", { baseUrl: "http://configured:4000/", fetch: d.fn }));
    expect(d.calls[0]!.headers["authorization"]).toBe("Bearer env-secret");
  });

  it("never follows redirects (auth headers must not survive them)", async () => {
    let seen: RequestInit | undefined;
    const fn = (async (_u: string | URL | Request, init?: RequestInit) => {
      seen = init;
      return json({ data: [{ id: "x" }] });
    }) as typeof fetch;
    await run(listProviderModels("litellm", { baseUrl: "http://proxy:4000", apiKey: "k", fetch: fn }));
    expect(seen?.redirect).toBe("error");
  });

  it("ollama: /api/tags, honors OLLAMA_HOST, needs no credentials, drops embedders", async () => {
    process.env.OLLAMA_HOST = "10.0.0.5:11434";
    const { fn, calls } = makeFetch(() =>
      json({ models: [{ name: "qwen3:14b" }, { name: "nomic-embed-text:latest" }] }),
    );
    const r = await run(listProviderModels("ollama", { fetch: fn }));
    if (r._tag !== "Right") throw new Error("expected Right");
    expect(ids(r.right)).toEqual(["qwen3:14b"]);
    expect(calls[0]!.url).toBe("http://10.0.0.5:11434/api/tags");
  });

  it("test provider: static, no fetch", async () => {
    const { fn, calls } = makeFetch(() => json({}));
    const r = await run(listProviderModels("test", { fetch: fn }));
    expect(r._tag).toBe("Right");
    expect(calls).toHaveLength(0);
  });
});

describe("credentials from env", () => {
  it("reads the provider's env var and sends it", async () => {
    process.env.GROQ_API_KEY = "env-groq";
    const { fn, calls } = makeFetch(() => json({ data: [{ id: "m" }] }));
    await run(listProviderModels("groq", { fetch: fn }));
    expect(calls[0]!.headers["authorization"]).toBe("Bearer env-groq");
  });
});

describe("errors", () => {
  it("no key -> no-credentials and no fetch", async () => {
    const { fn, calls } = makeFetch(() => json({}));
    const r = await run(listProviderModels("openai", { fetch: fn }));
    expect(r._tag).toBe("Left");
    if (r._tag === "Left") {
      expect(r.left).toBeInstanceOf(ModelDiscoveryError);
      expect(r.left.reason).toBe("no-credentials");
      expect(r.left.message).toContain("OPENAI_API_KEY");
    }
    expect(calls).toHaveLength(0);
  });

  it("401 -> http with status, message omits the key", async () => {
    const { fn } = makeFetch(() => json({ error: "bad" }, 401));
    const r = await run(listProviderModels("openai", { apiKey: "sk-secret-zzz", fetch: fn }));
    if (r._tag !== "Left") throw new Error("expected Left");
    expect(r.left.reason).toBe("http");
    expect(r.left.status).toBe(401);
    expect(r.left.message).not.toContain("sk-secret-zzz");
  });

  it("hang -> unreachable on timeout", async () => {
    const { fn } = makeFetch(() => new Promise<Response>(() => {}));
    const r = await run(listProviderModels("openai", { apiKey: "k", fetch: fn, timeoutMs: 30 }));
    if (r._tag !== "Left") throw new Error("expected Left");
    expect(r.left.reason).toBe("unreachable");
  });

  it("network failure -> unreachable", async () => {
    const { fn } = makeFetch(() => Promise.reject(new TypeError("fetch failed")));
    const r = await run(listProviderModels("ollama", { fetch: fn }));
    if (r._tag !== "Left") throw new Error("expected Left");
    expect(r.left.reason).toBe("unreachable");
  });

  it("malformed JSON -> parse; wrong shape -> parse", async () => {
    const bad = makeFetch(() => new Response("<html>", { status: 200 }));
    const r1 = await run(listProviderModels("openai", { apiKey: "k", fetch: bad.fn }));
    if (r1._tag !== "Left") throw new Error("expected Left");
    expect(r1.left.reason).toBe("parse");
    const shape = makeFetch(() => json({ nope: true }));
    const r2 = await run(listProviderModels("openai", { apiKey: "k2", fetch: shape.fn }));
    if (r2._tag !== "Left") throw new Error("expected Left");
    expect(r2.left.reason).toBe("parse");
  });
});

describe("resolveProviderModels", () => {
  it("live first, then presets not already listed, no duplicates", async () => {
    const { fn } = makeFetch(() => json({ data: [{ id: "brand-new-model" }, { id: "claude-haiku-4-5" }] }));
    const r = await Effect.runPromise(resolveProviderModels("anthropic", { apiKey: "k", fetch: fn }));
    expect(r.live).toBe(true);
    expect(r.error).toBeUndefined();
    const got = ids(r.models);
    expect(got.slice(0, 2)).toEqual(["brand-new-model", "claude-haiku-4-5"]);
    expect(new Set(got).size).toBe(got.length);
    expect(r.models.find((m) => m.id === "brand-new-model")!.source).toBe("live");
    expect(r.models.slice(2).every((m) => m.source === "preset")).toBe(true);
    expect(r.models.length).toBeGreaterThan(2);
  });

  it("failure -> presets only, live:false, error present", async () => {
    const { fn } = makeFetch(() => json({}, 500));
    const r = await Effect.runPromise(resolveProviderModels("anthropic", { apiKey: "k", fetch: fn }));
    expect(r.live).toBe(false);
    expect(r.error?.reason).toBe("http");
    expect(r.models.length).toBeGreaterThan(0);
    expect(r.models.every((m) => m.source === "preset")).toBe(true);
  });

  it("no credentials for groq (no presets) -> empty models, live:false, error", async () => {
    const r = await Effect.runPromise(resolveProviderModels("groq", {}));
    expect(r.live).toBe(false);
    expect(r.error?.reason).toBe("no-credentials");
  });
});

describe("cache", () => {
  it("second call in TTL makes no fetch; different key fetches again", async () => {
    const { fn, calls } = makeFetch(() => json({ data: [{ id: "m1" }] }));
    await run(listProviderModels("openai", { apiKey: "key-A", fetch: fn }));
    await run(listProviderModels("openai", { apiKey: "key-A", fetch: fn }));
    expect(calls).toHaveLength(1);
    await run(listProviderModels("openai", { apiKey: "key-B", fetch: fn }));
    expect(calls).toHaveLength(2);
  });

  it("failures are not cached", async () => {
    let n = 0;
    const { fn, calls } = makeFetch(() => (n++ === 0 ? json({}, 503) : json({ data: [{ id: "m" }] })));
    const a = await run(listProviderModels("openai", { apiKey: "k", fetch: fn }));
    const b = await run(listProviderModels("openai", { apiKey: "k", fetch: fn }));
    expect(a._tag).toBe("Left");
    expect(b._tag).toBe("Right");
    expect(calls).toHaveLength(2);
  });
});

describe("key isolation", () => {
  it("each provider's key only reaches that provider's host", async () => {
    const keys: Record<string, string> = {
      anthropic: "KEY-ANTHROPIC", openai: "KEY-OPENAI", gemini: "KEY-GEMINI", groq: "KEY-GROQ", xai: "KEY-XAI",
    };
    const hosts: Record<string, string> = {
      anthropic: "api.anthropic.com", openai: "api.openai.com",
      gemini: "generativelanguage.googleapis.com", groq: "api.groq.com", xai: "api.x.ai",
    };
    const { fn, calls } = makeFetch(() => json({ data: [], models: [] }));
    for (const p of Object.keys(keys) as (keyof typeof keys)[]) {
      await run(listProviderModels(p as "openai", { apiKey: keys[p]!, fetch: fn, baseUrl: "http://evil.example" }));
    }
    for (const c of calls) {
      const host = new URL(c.url).host;
      const sent = Object.values(c.headers).join("|") + c.url;
      for (const [p, k] of Object.entries(keys)) {
        if (sent.includes(k)) expect(host).toBe(hosts[p]!);
      }
    }
    // fixed hosts ignore a caller-supplied baseUrl
    expect(calls.every((c) => !c.url.includes("evil.example"))).toBe(true);
    expect(calls).toHaveLength(5);
  });
});

describe("isChatModel", () => {
  it("documented denylist per provider", () => {
    expect(isChatModel("openai", "gpt-4o")).toBe(true);
    for (const id of ["text-embedding-3-large", "tts-1-hd", "whisper-1", "dall-e-2", "omni-moderation-latest", "gpt-4o-realtime-preview", "gpt-image-1"])
      expect(isChatModel("openai", id)).toBe(false);
    expect(isChatModel("gemini", "gemini-2.5-pro")).toBe(true);
    expect(isChatModel("gemini", "imagen-4.0-generate")).toBe(false);
    expect(isChatModel("groq", "llama-guard-4-12b")).toBe(false);
    expect(isChatModel("groq", "playai-tts")).toBe(false);
    expect(isChatModel("xai", "grok-2-image")).toBe(false);
    expect(isChatModel("anthropic", "claude-opus-4-8")).toBe(true);
    expect(isChatModel("ollama", "bge-m3:latest")).toBe(false);
  });
});
