import { describe, expect, it } from "bun:test";
import { endpointNote, isCloudEndpoint, ollamaSettingsApi, parseOllamaSettings, OLLAMA_CLOUD_ENDPOINT } from "./ollama-endpoint.js";

const view = (over: Record<string, unknown> = {}) => ({ endpoint: null, effective: "http://localhost:11434", cloud: false, local: true, cloudEndpoint: OLLAMA_CLOUD_ENDPOINT, ...over });

describe("ollama endpoint settings", () => {
  it("recognises the cloud preset however it is typed", () => {
    expect(isCloudEndpoint("https://ollama.com")).toBe(true);
    expect(isCloudEndpoint(" https://ollama.com/ ")).toBe(true);
    expect(isCloudEndpoint("http://localhost:11434")).toBe(false);
    expect(isCloudEndpoint("")).toBe(false);
  });

  it("parses the server view and rejects junk", () => {
    expect(parseOllamaSettings(view({ endpoint: "https://ollama.com", effective: "https://ollama.com", cloud: true, local: false }))).toMatchObject({ cloud: true, local: false });
    expect(parseOllamaSettings(null)).toBeNull();
    expect(parseOllamaSettings({ endpoint: "x" })).toBeNull();
  });

  it("says what agents use and whether a key is needed or sent", () => {
    expect(endpointNote(parseOllamaSettings(view({ effective: "https://ollama.com", cloud: true, local: false })))).toContain("needs an Ollama API key");
    expect(endpointNote(parseOllamaSettings(view()))).toContain("no key is sent");
    expect(endpointNote(parseOllamaSettings(view({ effective: "http://gpu-box:11434", local: false })))).toContain("this host only");
    expect(endpointNote(null)).toContain("Could not read");
  });

  it("saves the Cloud preset with a PUT and clears with null", async () => {
    const calls: { url: string; body: unknown }[] = [];
    const fake = (async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(JSON.stringify(view({ endpoint: OLLAMA_CLOUD_ENDPOINT, effective: OLLAMA_CLOUD_ENDPOINT, cloud: true, local: false })));
    }) as unknown as typeof fetch;
    const api = ollamaSettingsApi("http://srv", fake);
    expect((await api.save(OLLAMA_CLOUD_ENDPOINT)).ok).toBe(true);
    await api.save("  ");
    expect(calls.map((c) => c.body)).toEqual([{ endpoint: OLLAMA_CLOUD_ENDPOINT }, { endpoint: null }]);
    expect(calls[0]?.url).toBe("http://srv/api/settings/ollama");
  });

  it("surfaces the server's refusal", async () => {
    const fake = (async () => new Response(JSON.stringify({ error: "Endpoint must be an http(s) URL" }), { status: 400 })) as unknown as typeof fetch;
    expect(await ollamaSettingsApi("http://srv", fake).save("ftp://x")).toEqual({ ok: false, error: "Endpoint must be an http(s) URL" });
  });
});
