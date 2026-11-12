// Run: bun run repo test apps/cortex/server/tests/web-search-keys.test.ts
//
// Settings · Web search keys: every keyed provider the framework's web-search chain has
// (including Keenable) is storable, tested with a one-result search, and never echoed.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { providerKeysRouter, type ListModelsWithKey } from "../api/provider-keys.js";
import { ProviderKeyStore, PROVIDER_KEYS_FILE } from "../services/provider-key-store.js";
import {
  isWebSearchKeyId,
  probeWebSearchKey,
  WEB_SEARCH_PROVIDERS,
  type WebSearchProbe,
} from "../services/web-search-keys.js";

const KEY = "ws-fake-0123456789abcdWXYZ";
let dir: string;
let store: ProviderKeyStore;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cortex-wskeys-"));
  store = new ProviderKeyStore({ dir, env: {}, now: () => 1_000 });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const noModels: ListModelsWithKey = async () => ({ ok: true, count: 0 });
const call = (probe: WebSearchProbe, method: string, path: string, body?: unknown) =>
  providerKeysRouter(store, noModels, undefined, probe).handle(
    new Request(`http://localhost/api/settings/keys${path}`, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
const passing: WebSearchProbe = async () => ({ ok: true });

describe("web-search provider table", () => {
  it("names every keyed provider of the framework chain, Keenable included", () => {
    const env = WEB_SEARCH_PROVIDERS.flatMap((p) => p.env);
    expect(env).toEqual(["TAVILY_API_KEY", "BRAVE_SEARCH_API_KEY", "BRAVE_API_KEY", "SERPER_API_KEY", "KEENABLE_API_KEY"]);
    expect(WEB_SEARCH_PROVIDERS.every((p) => isWebSearchKeyId(p.id))).toBe(true);
  });
});

describe("web-search keys in the store and API", () => {
  it("stores, lists (masked), and removes a key for each provider", async () => {
    for (const p of WEB_SEARCH_PROVIDERS) {
      const put = await call(passing, "PUT", `/${p.id}`, { apiKey: KEY });
      expect(put.status).toBe(200);
      expect(await put.text()).not.toContain(KEY);
    }
    expect(readFileSync(join(dir, PROVIDER_KEYS_FILE), "utf8")).not.toContain(KEY);
    const listText = await (await call(passing, "GET", "/")).text();
    expect(listText).not.toContain(KEY);
    const list = JSON.parse(listText) as { providers: { provider: string; stored: { masked: string } | null; appliesToAgents: boolean }[] };
    for (const p of WEB_SEARCH_PROVIDERS) {
      const row = list.providers.find((x) => x.provider === p.id);
      expect(row?.stored?.masked).toBe("••••WXYZ");
      // The framework reads web-search keys from the environment only (reported gap).
      expect(row?.appliesToAgents).toBe(false);
    }
    const del = (await (await call(passing, "DELETE", "/websearch-keenable")).json()) as { stored: unknown };
    expect(del.stored).toBeNull();
  });

  it("Test probes with the typed key, else the saved one, and redacts a failure", async () => {
    const seen: string[] = [];
    const probe: WebSearchProbe = async (id, key) => {
      seen.push(`${id}:${key}`);
      return { ok: false, error: `bad key ${key}` };
    };
    const typed = (await (await call(probe, "POST", "/websearch-keenable/test", { apiKey: KEY })).json()) as { ok: boolean; tried: string; error: string };
    expect(typed).toMatchObject({ ok: false, tried: "typed" });
    expect(typed.error).not.toContain(KEY);

    expect(await (await call(probe, "POST", "/websearch-tavily/test", {})).json()).toMatchObject({ ok: false, tried: "none" });

    await call(passing, "PUT", "/websearch-tavily", { apiKey: KEY });
    expect(await (await call(passing, "POST", "/websearch-tavily/test", {})).json()).toEqual({ ok: true, tried: "stored" });
    expect(seen).toEqual([`websearch-keenable:${KEY}`]);
  });
});

describe("probeWebSearchKey", () => {
  const reply = (status: number): typeof fetch => (async () => new Response("{}", { status })) as unknown as typeof fetch;

  it("sends a one-result search with the key in the provider's header or body", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const rec: typeof fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    for (const p of WEB_SEARCH_PROVIDERS) expect(await probeWebSearchKey(p.id, KEY, rec)).toEqual({ ok: true });
    const keenable = calls[3];
    expect(keenable?.url).toBe("https://api.keenable.ai/v1/search");
    expect((keenable?.init.headers as Record<string, string>)["X-API-Key"]).toBe(KEY);
    expect(calls.map((c) => new URL(c.url).host)).toEqual([
      "api.tavily.com",
      "api.search.brave.com",
      "google.serper.dev",
      "api.keenable.ai",
    ]);
  });

  it("maps 401 to a rejected key and other statuses to a plain line", async () => {
    expect(await probeWebSearchKey("websearch-brave", KEY, reply(401))).toMatchObject({ ok: false, error: expect.stringContaining("rejected") });
    expect(await probeWebSearchKey("websearch-brave", KEY, reply(500))).toMatchObject({ ok: false, error: "The provider answered HTTP 500." });
    const boom: typeof fetch = (async () => {
      throw new Error(`connect failed for ${KEY}`);
    }) as unknown as typeof fetch;
    const r = await probeWebSearchKey("websearch-serper", KEY, boom);
    expect(JSON.stringify(r)).not.toContain(KEY);
  });
});
