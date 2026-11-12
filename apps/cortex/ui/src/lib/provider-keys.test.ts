import { describe, expect, test } from "bun:test";
import {
  keyRowHintOf,
  keyRowLabelOf,
  keyRowOf,
  keysInScope,
  parseKeysResponse,
  providerKeysApi,
  testResultLine,
  withStatus,
  type ProviderKeyStatus,
} from "./provider-keys.js";

const base: ProviderKeyStatus = {
  provider: "openai",
  env: ["OPENAI_API_KEY"],
  envSet: false,
  stored: null,
  unreadable: false,
  source: "none",
  appliesToAgents: true,
};
const saved = { masked: "••••WXYZ", updatedAt: 1, preferStored: false };

describe("Ollama Cloud and TypeSafe rows", () => {
  test("named for what they are, with a hint that says where the key goes", () => {
    expect(keyRowLabelOf("ollama")).toBe("Ollama Cloud (API key)");
    expect(keyRowLabelOf("typesafe")).toBe("TypeSafe (Jev judgment)");
    expect(keyRowLabelOf("openai")).toBeUndefined();
    expect(keyRowHintOf("ollama")).toContain("never to a local server");
    expect(keyRowHintOf("typesafe")).toContain("nothing is billed");
    expect(keyRowHintOf("openai")).toBeNull();
  });
  test("an env-only Ollama key reads like any provider's", () => {
    const row = keyRowOf({ ...base, provider: "ollama", env: ["OLLAMA_API_KEY"], envSet: true, source: "env" });
    expect(row.summary).toContain("OLLAMA_API_KEY");
    expect(row.badge.text).toBe("Environment");
  });
});

describe("web-search key rows", () => {
  const ws: ProviderKeyStatus = { ...base, provider: "websearch-keenable", env: ["KEENABLE_API_KEY"], appliesToAgents: false };
  test("scopes split LLM and web-search keys", () => {
    const list = [base, ws, { ...ws, provider: "websearch-tavily" }];
    expect(keysInScope(list, "llm").map((p) => p.provider)).toEqual(["openai"]);
    expect(keysInScope(list, "web-search").map((p) => p.provider)).toEqual(["websearch-keenable", "websearch-tavily"]);
  });
  test("named, and never claims agents use a saved key", () => {
    expect(keyRowLabelOf("websearch-keenable")).toBe("Keenable");
    const row = keyRowOf({ ...ws, stored: saved, source: "stored" });
    expect(row.badge.text).toBe("Saved, not used yet");
    expect(row.summary).toContain("KEENABLE_API_KEY");
    expect(row.summary).not.toContain("Agents use the saved");
    expect(row.showPrefer).toBe(false);
    expect(keyRowHintOf("websearch-keenable")).toContain("environment only");
  });
  test("a web-search Test line has no model count", () => {
    expect(testResultLine({ ok: true, tried: "stored" }).text).toBe("The saved key works: a test search succeeded.");
  });
});

describe("provider key rows", () => {
  test("no key asks for one and names the env variable", () => {
    const row = keyRowOf(base);
    expect(row.badge).toEqual({ tone: "bad", text: "No key" });
    expect(row.summary).toContain("OPENAI_API_KEY");
    expect(row.showPrefer).toBe(false);
  });

  test("saved key in use shows only the mask", () => {
    const row = keyRowOf({ ...base, stored: saved, source: "stored" });
    expect(row.badge.text).toBe("Saved key");
    expect(row.summary).toBe("Agents use the saved key ••••WXYZ.");
  });

  test("env wins: saved key is a spare, and the switch shows", () => {
    const row = keyRowOf({ ...base, envSet: true, stored: saved, source: "env" });
    expect(row.badge.text).toBe("Environment");
    expect(row.summary).toContain("spare");
    expect(row.showPrefer).toBe(true);
  });

  test("a saved Anthropic key reaches agents: no Test-only warning", () => {
    const row = keyRowOf({ ...base, provider: "anthropic", env: ["ANTHROPIC_API_KEY"], stored: saved, source: "stored" });
    expect(row.badge).toEqual({ tone: "ok", text: "Saved key" });
    expect(row.note).toBeNull();
    expect(row.summary).toBe("Agents use the saved key ••••WXYZ.");
  });

  test("unreadable entry says to save again", () => {
    expect(keyRowOf({ ...base, unreadable: true }).note).toContain("Save the key again");
  });
});

describe("parsing and calls", () => {
  test("parseKeysResponse drops junk and defaults fields", () => {
    const r = parseKeysResponse({ providers: [{ provider: "groq", source: "weird" }, 3], dir: "/d" });
    expect(r.dir).toBe("/d");
    expect(r.providers).toHaveLength(1);
    expect(r.providers[0]?.source).toBe("none");
    expect(parseKeysResponse(null)).toEqual({ providers: [], dir: "" });
  });

  test("the Settings · Voice endpoint keys are not listed as providers", () => {
    const r = parseKeysResponse({ providers: [{ provider: "openai" }, { provider: "voice-stt" }, { provider: "voice-tts" }], dir: "/d" });
    expect(r.providers.map((p) => p.provider)).toEqual(["openai"]);
  });

  test("testResultLine", () => {
    expect(testResultLine({ ok: true, tried: "typed", models: 1 })).toEqual({ tone: "ok", text: "This key works: 1 model listed." });
    expect(testResultLine({ ok: false, tried: "stored", error: "HTTP 401" })).toEqual({ tone: "bad", text: "HTTP 401" });
  });

  test("save sends PUT with the key; errors come back as values", async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const fake = (async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(url), init });
      if (init?.method === "DELETE") return new Response(JSON.stringify({ error: "nope" }), { status: 500 });
      return new Response(JSON.stringify({ ...base, stored: saved, source: "stored" }), { status: 200 });
    }) as typeof fetch;
    const api = providerKeysApi("http://x", fake);
    const r = await api.save("openai", "k-123");
    expect(r.ok).toBe(true);
    expect(seen[0]?.url).toBe("http://x/api/settings/keys/openai");
    expect(seen[0]?.init?.method).toBe("PUT");
    expect(JSON.parse(String(seen[0]?.init?.body))).toEqual({ apiKey: "k-123" });
    const d = await api.remove("openai");
    expect(d).toEqual({ ok: false, error: "nope" });
  });

  test("withStatus replaces by provider", () => {
    const next = withStatus([base, { ...base, provider: "groq" }], { ...base, source: "env" });
    expect(next.map((p) => p.source)).toEqual(["env", "none"]);
  });
});
