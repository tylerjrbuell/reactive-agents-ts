import { describe, it, expect } from "bun:test";
import { listProviders } from "../../../server/api/models.js";
import { PROVIDER_FALLBACK, loadProviders, resetProvidersCache } from "./providers.js";
import { CHAT_PROVIDERS } from "./inference-presets.js";

describe("provider list", () => {
  it("PROVIDER_FALLBACK ids equal the server list (drift pin)", () => {
    expect(PROVIDER_FALLBACK.map((p) => p.id).sort()).toEqual(listProviders().map((p) => p.id).sort());
    expect(PROVIDER_FALLBACK.map((p) => p.id)).toContain("groq");
    expect(PROVIDER_FALLBACK.map((p) => p.id)).toContain("xai");
  });

  it("CHAT_PROVIDERS derives from the fallback, so a restored groq session is recognised", () => {
    expect([...CHAT_PROVIDERS]).toEqual(PROVIDER_FALLBACK.map((p) => p.id));
    expect((CHAT_PROVIDERS as readonly string[]).includes("groq")).toBe(true);
  });

  it("loadProviders uses the server list and caches it", async () => {
    resetProvidersCache();
    let calls = 0;
    const fetchImpl = Object.assign(
      async () => {
        calls++;
        return new Response(JSON.stringify({ providers: [{ id: "newprov", label: "New", local: false }] }));
      },
      { preconnect: (): void => {} },
    );
    const a = await loadProviders(fetchImpl);
    const b = await loadProviders(fetchImpl);
    expect(a.map((p) => p.id)).toEqual(["newprov"]);
    expect(b).toBe(a);
    expect(calls).toBe(1);
  });

  it("loadProviders falls back when the server is unreachable", async () => {
    resetProvidersCache();
    const fetchImpl = Object.assign(
      async (): Promise<Response> => {
        throw new Error("offline");
      },
      { preconnect: (): void => {} },
    );
    expect(await loadProviders(fetchImpl)).toEqual(PROVIDER_FALLBACK);
  });
});
