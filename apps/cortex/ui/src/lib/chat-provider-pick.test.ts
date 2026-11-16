import { describe, expect, test } from "bun:test";
import { loadProviderBlocks, modelAfterProviderSwitch, providerBlocks, providerSwitch } from "./chat-provider-pick.js";
import type { ProviderKeyStatus } from "./provider-keys.js";

const key = (provider: string, source: ProviderKeyStatus["source"], env = [`${provider.toUpperCase()}_API_KEY`]): ProviderKeyStatus => ({
  provider, env, envSet: source === "env", stored: null, unreadable: false, source, appliesToAgents: true,
});

describe("providerBlocks", () => {
  test("a keyed provider with no key is blocked with the env name", () => {
    const b = providerBlocks([key("anthropic", "none"), key("openai", "env"), key("gemini", "stored")], true);
    expect(b).toEqual({ anthropic: "no API key configured (ANTHROPIC_API_KEY)" });
  });
  test("keyless providers are never blocked by a missing key (ollama cloud key is optional)", () => {
    expect(providerBlocks([key("ollama", "none"), key("litellm", "none")], true)).toEqual({});
  });
  test("unreachable Ollama is blocked; unchecked stays selectable", () => {
    expect(providerBlocks([], false)).toEqual({ ollama: "Ollama not reachable" });
    expect(providerBlocks(null, null)).toEqual({});
  });
});

describe("loadProviderBlocks", () => {
  const keysFetch = (async () => new Response(JSON.stringify({ providers: [key("anthropic", "none")], dir: "" }), { headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
  test("combines key status and Ollama reachability", async () => {
    const b = await loadProviderBlocks("http://x", keysFetch, async () => ({ options: [], error: "Could not reach Ollama" }));
    expect(Object.keys(b).sort()).toEqual(["anthropic", "ollama"]);
  });
  test("a failed lookup blocks nothing", async () => {
    const boom = (async () => { throw new Error("down"); }) as unknown as typeof fetch;
    expect(await loadProviderBlocks("http://x", boom, async () => { throw new Error("down"); })).toEqual({});
  });
});

describe("modelAfterProviderSwitch", () => {
  const opts = [{ value: "a", label: "a" }, { value: "b", label: "b" }];
  test("keeps the current model when the new provider lists it", () => expect(modelAfterProviderSwitch("b", opts, "a")).toBe("b"));
  test("else the provider default", () => expect(modelAfterProviderSwitch("zzz", opts, "a")).toBe("a"));
  test("else the first listed", () => expect(modelAfterProviderSwitch("zzz", opts, undefined)).toBe("a"));
  test("nothing known gives undefined", () => expect(modelAfterProviderSwitch("zzz", [], undefined)).toBeUndefined());
});

describe("providerSwitch", () => {
  test("patches provider and the reconciled model", async () => {
    const r = await providerSwitch("openai", "qwen", async () => ({ options: [{ value: "gpt", label: "gpt" }], default: "gpt" }));
    expect(r).toEqual({ label: "Provider openai, model gpt", patch: { provider: "openai", model: "gpt" }, needsModel: false });
  });
  test("a model list that fails to load patches only the provider and asks for a model", async () => {
    const r = await providerSwitch("openai", "qwen", async () => { throw new Error("x"); });
    expect(r).toMatchObject({ patch: { provider: "openai" }, needsModel: true });
  });
});
