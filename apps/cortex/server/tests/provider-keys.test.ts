// Run: bun run repo test apps/cortex/server/tests/provider-keys.test.ts
//
// Settings · Providers key store: encrypted at rest, files 0600, the API never returns a
// key, env-vs-stored precedence, and the build funnel hands the winning key to the builder.
import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReactiveAgentBuilder } from "@reactive-agents/runtime";
import {
  installProviderKeyStore,
  KEYED_PROVIDER_ENV,
  maskKey,
  ProviderKeyStore,
  PROVIDER_KEYS_FILE,
  providerKeyForAgent,
  redactKey,
  SECRET_KEY_FILE,
} from "../services/provider-key-store.js";
import { providerKeysRouter, type ListModelsWithKey } from "../api/provider-keys.js";
import { buildCortexAgent } from "../services/build-cortex-agent.js";
import { checkProviders } from "../api/health.js";
import { createModelsRouter } from "../api/models.js";

const KEY = "sk-fake-test-0123456789abcdWXYZ";
let dir: string;
let env: Record<string, string | undefined>;
let store: ProviderKeyStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cortex-keys-"));
  env = {};
  store = new ProviderKeyStore({ dir, env, now: () => 1_000 });
});
afterEach(() => {
  installProviderKeyStore(null);
  rmSync(dir, { recursive: true, force: true });
});

const unwrap = <A>(r: { ok: true; value: A } | { ok: false; error: { message: string } }): A => {
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};

describe("ProviderKeyStore", () => {
  it("round-trips a key and keeps only ciphertext on disk", () => {
    unwrap(store.set("openai", KEY));
    expect(store.storedKey("openai")).toBe(KEY);
    const raw = readFileSync(join(dir, PROVIDER_KEYS_FILE), "utf8");
    expect(raw).not.toContain(KEY);
    expect(raw).not.toContain(KEY.slice(-12));
    // A fresh instance over the same dir reads it back.
    expect(new ProviderKeyStore({ dir, env }).storedKey("openai")).toBe(KEY);
  });

  it("creates the key file and the keys file with mode 0600", () => {
    unwrap(store.set("anthropic", KEY));
    expect(statSync(join(dir, SECRET_KEY_FILE)).mode & 0o777).toBe(0o600);
    expect(statSync(join(dir, PROVIDER_KEYS_FILE)).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(dir, SECRET_KEY_FILE)).length).toBe(32);
  });

  it("replaces a key with a fresh iv and removes it", () => {
    unwrap(store.set("openai", KEY));
    const first = JSON.parse(readFileSync(join(dir, PROVIDER_KEYS_FILE), "utf8")).keys.openai.iv;
    unwrap(store.set("openai", `${KEY}-2`));
    const second = JSON.parse(readFileSync(join(dir, PROVIDER_KEYS_FILE), "utf8")).keys.openai.iv;
    expect(second).not.toBe(first);
    expect(store.storedKey("openai")).toBe(`${KEY}-2`);
    const removed = unwrap(store.remove("openai"));
    expect(removed.stored).toBeNull();
    expect(store.storedKey("openai")).toBeUndefined();
  });

  it("binds an entry to its provider (moved ciphertext is unreadable, not a crash)", () => {
    unwrap(store.set("openai", KEY));
    const path = join(dir, PROVIDER_KEYS_FILE);
    const file = JSON.parse(readFileSync(path, "utf8"));
    file.keys.groq = file.keys.openai;
    writeFileSync(path, JSON.stringify(file));
    expect(store.storedKey("groq")).toBeUndefined();
    const groq = unwrap(store.status("groq"));
    expect(groq.unreadable).toBe(true);
    expect(groq.stored).toBeNull();
  });

  it("reports entries sealed by a replaced secret key as unreadable", () => {
    unwrap(store.set("openai", KEY));
    writeFileSync(join(dir, SECRET_KEY_FILE), Buffer.alloc(32, 7));
    expect(store.storedKey("openai")).toBeUndefined();
    expect(unwrap(store.status("openai")).unreadable).toBe(true);
  });

  it("refuses unknown providers and empty keys", () => {
    const unknown = store.set("ollama", KEY);
    expect(unknown.ok).toBe(false);
    const empty = store.set("openai", "   ");
    expect(empty.ok).toBe(false);
  });

  it("env wins unless preferStored; stored wins when env is empty", () => {
    unwrap(store.set("openai", KEY));
    expect(store.keyForAgent("openai")).toBe(KEY);
    expect(unwrap(store.status("openai")).source).toBe("stored");

    env.OPENAI_API_KEY = "env-key";
    expect(store.keyForAgent("openai")).toBeUndefined();
    expect(unwrap(store.status("openai")).source).toBe("env");

    unwrap(store.setPreferStored("openai", true));
    expect(store.keyForAgent("openai")).toBe(KEY);
    expect(unwrap(store.status("openai")).source).toBe("stored");

    // Replacing the key keeps the user's choice.
    unwrap(store.set("openai", `${KEY}-2`));
    expect(unwrap(store.status("openai")).stored?.preferStored).toBe(true);
  });

  it("a stored key reaches agents for every keyed provider", () => {
    // Every llm-provider adapter honours `.withProvider(p, { apiKey })` (d1955526c),
    // anthropic and gemini included.
    for (const p of Object.keys(KEYED_PROVIDER_ENV)) {
      expect(unwrap(store.status(p)).appliesToAgents).toBe(true);
    }
  });

  it("masks and redacts", () => {
    expect(maskKey(KEY)).toBe("••••WXYZ");
    expect(maskKey("short")).toBe("••••");
    expect(redactKey(`bad key ${KEY} rejected`, KEY)).toBe("bad key ••••WXYZ rejected");
  });
});

describe("/api/settings/keys", () => {
  const okList: ListModelsWithKey = async () => ({ ok: true, count: 3 });
  const app = (list: ListModelsWithKey = okList) => providerKeysRouter(store, list);
  const call = (a: ReturnType<typeof app>, method: string, path: string, body?: unknown) =>
    a.handle(
      new Request(`http://localhost/api/settings/keys${path}`, {
        method,
        headers: body === undefined ? {} : { "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );

  it("never returns the key: PUT and GET carry only the mask", async () => {
    const a = app();
    const put = await call(a, "PUT", "/openai", { apiKey: KEY });
    expect(put.status).toBe(200);
    const putText = await put.text();
    expect(putText).not.toContain(KEY);
    expect(JSON.parse(putText).stored.masked).toBe("••••WXYZ");

    const get = await call(a, "GET", "/");
    const text = await get.text();
    expect(text).not.toContain(KEY);
    const body = JSON.parse(text) as { providers: { provider: string; source: string; stored: { masked: string } | null }[] };
    const openai = body.providers.find((p) => p.provider === "openai");
    expect(openai?.source).toBe("stored");
    expect(openai?.stored?.masked).toBe("••••WXYZ");
    expect(body.providers.map((p) => p.provider)).toContain("anthropic");
  });

  it("PATCH sets preferStored, DELETE removes, unknown provider is 400", async () => {
    const a = app();
    await call(a, "PUT", "/openai", { apiKey: KEY });
    const patched = (await (await call(a, "PATCH", "/openai", { preferStored: true })).json()) as { stored: { preferStored: boolean } };
    expect(patched.stored.preferStored).toBe(true);
    const deleted = (await (await call(a, "DELETE", "/openai")).json()) as { stored: unknown; source: string };
    expect(deleted.stored).toBeNull();
    expect(deleted.source).toBe("none");
    expect((await call(a, "PUT", "/ollama", { apiKey: KEY })).status).toBe(400);
    expect((await call(a, "PATCH", "/groq", { preferStored: true })).status).toBe(404);
  });

  it("tests the typed key, else the agent's key, and redacts failures", async () => {
    const seen: (string | undefined)[] = [];
    const failing: ListModelsWithKey = async (_p, opts) => {
      seen.push(opts.apiKey);
      return { ok: false, message: `HTTP 401 for key ${opts.apiKey}` };
    };
    const a = app(failing);
    const typed = (await (await call(a, "POST", "/openai/test", { apiKey: KEY })).json()) as { ok: boolean; tried: string; error: string };
    expect(typed.ok).toBe(false);
    expect(typed.tried).toBe("typed");
    expect(typed.error).not.toContain(KEY);
    expect(typed.error).toContain("••••WXYZ");

    const none = (await (await call(a, "POST", "/openai/test", {})).json()) as { ok: boolean; tried: string };
    expect(none).toMatchObject({ ok: false, tried: "none" });

    await call(a, "PUT", "/openai", { apiKey: KEY });
    const stored = (await (await call(app(), "POST", "/openai/test", {})).json()) as { ok: boolean; tried: string; models: number };
    expect(stored).toEqual({ ok: true, tried: "stored", models: 3 });
    expect(seen).toEqual([KEY]);
  });
});

describe("stored keys reach the agent and the status endpoints", () => {
  it("buildCortexAgent passes the winning stored key as the provider config", async () => {
    unwrap(store.set("openai", KEY));
    installProviderKeyStore(store);
    expect(providerKeyForAgent("openai")).toBe(KEY);
    const spy = spyOn(ReactiveAgentBuilder.prototype, "withProvider");
    try {
      const agent = await buildCortexAgent({ provider: "openai", model: "gpt-4o-mini", memory: { working: false } });
      await agent.dispose();
      expect(spy.mock.calls.some((c) => c[0] === "openai" && c[1]?.apiKey === KEY)).toBe(true);

      spy.mockClear();
      env.OPENAI_API_KEY = "env-key";
      const envAgent = await buildCortexAgent({ provider: "openai", model: "gpt-4o-mini", memory: { working: false } });
      await envAgent.dispose();
      expect(spy.mock.calls.some((c) => c[1]?.apiKey !== undefined)).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it("health and model capability count a stored key as configured", async () => {
    expect(checkProviders({}, (p) => p === "openai").openai).toBe("ok");
    expect(checkProviders({}, () => false).openai).toBe("missing");
    const models = createModelsRouter({
      resolve: async () => ({ models: [], live: false }),
      fetch,
      env: {},
      storedKeys: { forAgent: () => undefined, has: (p) => p === "openai" },
    });
    const res = await models.handle(new Request("http://localhost/api/models/capability?provider=openai&model=gpt-4o"));
    expect(((await res.json()) as { keyConfigured: boolean }).keyConfigured).toBe(true);
  });

  it("model listing uses the agent's stored key", async () => {
    const keys: (string | undefined)[] = [];
    const models = createModelsRouter({
      resolve: async (_p, opts) => {
        keys.push(opts.apiKey);
        return { models: [], live: false };
      },
      fetch,
      storedKeys: { forAgent: (p) => (p === "openai" ? KEY : undefined), has: () => true },
    });
    await models.handle(new Request("http://localhost/api/models/openai"));
    await models.handle(new Request("http://localhost/api/models/anthropic"));
    expect(keys).toEqual([KEY, undefined]);
  });
});
