import { describe, it, expect } from "bun:test";
import { createModelsRouter, type ModelsDeps } from "../api/models.js";

const noFetch: typeof fetch = Object.assign(
  async () => {
    throw new Error("no network in tests");
  },
  { preconnect: () => undefined },
);

const live = (id: string, thinking: boolean | null = null) => ({
  id,
  label: id,
  source: "live" as const,
  supportsThinking: thinking,
  capabilitySource: "static-table" as const,
});

function appWith(resolve: ModelsDeps["resolve"], fetchImpl: typeof fetch = noFetch) {
  return createModelsRouter({ resolve, fetch: fetchImpl });
}
const get = (app: ReturnType<typeof appWith>, path: string) =>
  app.handle(new Request(`http://localhost${path}`));

describe("GET /api/models/:provider", () => {
  it("returns the merged list with live:true and the framework default", async () => {
    const app = appWith(async () => ({ models: [live("gpt-live-1"), live("gpt-4o")], live: true }));
    const res = await get(app, "/api/models/openai");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { models: { name: string; source: string }[]; live: boolean; default: string | null; error?: unknown };
    expect(body.live).toBe(true);
    expect(body.models.map((m) => m.name)).toEqual(["gpt-live-1", "gpt-4o"]);
    expect(body.models[0]?.source).toBe("live");
    expect(body.default).toBe("gpt-4o");
    expect(body.error).toBeUndefined();
  });

  it("falls back to presets with live:false and the error reason", async () => {
    const app = appWith(async () => ({
      models: [{ id: "claude-x", label: "Claude X", source: "preset" as const, supportsThinking: true, capabilitySource: "static-table" as const }],
      live: false,
      error: Object.assign(new Error("anthropic needs ANTHROPIC_API_KEY; none set"), { reason: "no-credentials" as const, provider: "anthropic", _tag: "ModelDiscoveryError" as const }),
    }) as never);
    const res = await get(app, "/api/models/anthropic");
    const body = (await res.json()) as { models: { name: string }[]; live: boolean; error?: { reason: string; message: string } };
    expect(body.live).toBe(false);
    expect(body.models.map((m) => m.name)).toEqual(["claude-x"]);
    expect(body.error?.reason).toBe("no-credentials");
    expect(body.error?.message).toContain("ANTHROPIC_API_KEY");
  });

  it("returns an empty list (no throw) when a provider has no presets and discovery fails", async () => {
    const app = appWith(async () => ({ models: [], live: false }));
    const res = await get(app, "/api/models/groq");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { models: unknown[]; live: boolean };
    expect(body.models).toEqual([]);
    expect(body.live).toBe(false);
  });

  it("ollama honors the endpoint query and probes thinking via api/show", async () => {
    let seenBaseUrl: string | undefined;
    const showCalls: string[] = [];
    const fetchStub = Object.assign(
      async (url: string | URL | Request) => {
        showCalls.push(String(url));
        return new Response(JSON.stringify({ capabilities: ["completion", "thinking"] }), { status: 200, headers: { "content-type": "application/json" } });
      },
      { preconnect: () => undefined },
    );
    const app = appWith(async (_p, opts) => {
      seenBaseUrl = opts.baseUrl;
      return { models: [live("qwen3:14b")], live: true };
    }, fetchStub);
    const res = await get(app, `/api/models/ollama?endpoint=${encodeURIComponent("http://gpu-box:11434")}`);
    const body = (await res.json()) as { models: { name: string; supportsThinking: boolean | null }[] };
    expect(seenBaseUrl).toBe("http://gpu-box:11434");
    expect(showCalls).toEqual(["http://gpu-box:11434/api/show"]);
    expect(body.models[0]?.supportsThinking).toBe(true);
  });

  it("removed legacy aliases /framework/:provider and /ollama-as-route now 404", async () => {
    const app = appWith(async (p) => ({ models: [live(`${p}-m`)], live: true }));
    expect((await get(app, "/api/models/framework/openai")).status).toBe(404);
    expect((await get(app, "/api/models/framework/ollama")).status).toBe(404);
  });
});

describe("litellm endpoint allowlist", () => {
  const resolveOk = async () => ({ models: [live("m")], live: true });
  it("rejects non-http(s) and non-allowlisted hosts with 400", async () => {
    const app = appWith(resolveOk);
    for (const ep of ["https://attacker.example", "file:///etc/passwd", "ftp://localhost", "not a url"]) {
      const res = await get(app, `/api/models/litellm?endpoint=${encodeURIComponent(ep)}`);
      expect(res.status).toBe(400);
    }
  });
  it("accepts loopback and the configured LITELLM_BASE_URL", async () => {
    const app = appWith(resolveOk);
    for (const ep of ["http://localhost:4000", "http://127.0.0.1:4000", "http://[::1]:4000"]) {
      const res = await get(app, `/api/models/litellm?endpoint=${encodeURIComponent(ep)}`);
      expect(res.status).toBe(200);
    }
    const prev = process.env.LITELLM_BASE_URL;
    process.env.LITELLM_BASE_URL = "https://proxy.corp:4000";
    try {
      const res = await get(app, `/api/models/litellm?endpoint=${encodeURIComponent("https://proxy.corp:4000/")}`);
      expect(res.status).toBe(200);
    } finally {
      if (prev === undefined) delete process.env.LITELLM_BASE_URL;
      else process.env.LITELLM_BASE_URL = prev;
    }
  });
});

describe("GET /api/models/capability", () => {
  const env = (vars: Record<string, string | undefined>) => createModelsRouter({ resolve: async () => ({ models: [], live: false }), fetch: noFetch, env: vars });
  it("returns window, output limit, thinking support and key status for a known model", async () => {
    const res = await get(env({ ANTHROPIC_API_KEY: "k" }), "/api/models/capability?provider=anthropic&model=claude-sonnet-4-20250514");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { provider: string; model: string; maxContextTokens: number; maxOutputTokens: number; supportsThinking: boolean; keyConfigured: boolean | null; source: string };
    expect(body.provider).toBe("anthropic");
    expect(body.maxContextTokens).toBeGreaterThan(0);
    expect(body.maxOutputTokens).toBeGreaterThan(0);
    expect(typeof body.supportsThinking).toBe("boolean");
    expect(body.keyConfigured).toBe(true);
  });
  it("reports a missing key, and null for providers that need none", async () => {
    const missing = (await (await get(env({}), "/api/models/capability?provider=openai&model=gpt-4o")).json()) as { keyConfigured: boolean | null };
    expect(missing.keyConfigured).toBe(false);
    const local = (await (await get(env({}), "/api/models/capability?provider=ollama&model=cogito:14b")).json()) as { keyConfigured: boolean | null };
    expect(local.keyConfigured).toBeNull();
  });
  it("is not shadowed by /:provider and rejects a missing model", async () => {
    const res = await get(env({}), "/api/models/capability?provider=ollama");
    expect(res.status).toBe(400);
  });
});
