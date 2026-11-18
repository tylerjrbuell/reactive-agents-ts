// Run: bun test packages/runtime/tests/judgment-autoshadow.test.ts --timeout 30000
//
// Wave 7.1 auto-shadow probe: keyless-safe detection of a cheap local
// judgment backend. Opt-out env, unreachable server, or any error all resolve
// to undefined (no service, build proceeds unchanged) — never throws, never
// blocks a build.
import { describe, expect, it, afterEach } from "bun:test";
import { autoShadowRequested, probeAutoShadow } from "../src/judgment-autoshadow.js";

const ENV_KEYS = ["REACTIVE_AGENTS_NO_AUTO_SHADOW", "REACTIVE_AGENTS_AUTO_SHADOW","OLLAMA_ENDPOINT", "OLLAMA_HOST", "OLLAMA_BASE"] as const;
const saved: Record<string, string | undefined> = {};

function setEnv(key: string, value: string | undefined) {
  if (!(key in saved)) saved[key] = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k] as string;
  }
});

describe("7.1 auto-shadow request gate", () => {
  it("default (never set, no env) is off", () => {
    setEnv("REACTIVE_AGENTS_NO_AUTO_SHADOW", undefined);
    setEnv("REACTIVE_AGENTS_AUTO_SHADOW", undefined);
    expect(autoShadowRequested(undefined)).toBe(false);
  });

  it("builder opt-in or env opt-in turns it on", () => {
    setEnv("REACTIVE_AGENTS_NO_AUTO_SHADOW", undefined);
    setEnv("REACTIVE_AGENTS_AUTO_SHADOW", undefined);
    expect(autoShadowRequested(true)).toBe(true);
    setEnv("REACTIVE_AGENTS_AUTO_SHADOW", "1");
    expect(autoShadowRequested(undefined)).toBe(true);
  });

  it("builder opt-out beats env opt-in; opt-out env beats everything", () => {
    setEnv("REACTIVE_AGENTS_AUTO_SHADOW", "1");
    expect(autoShadowRequested(false)).toBe(false);
    setEnv("REACTIVE_AGENTS_NO_AUTO_SHADOW", "1");
    expect(autoShadowRequested(true)).toBe(false);
  });
});

describe("7.1 auto-shadow probe", () => {
  const stubTags = (names: string[]) => {
    const real = globalThis.fetch;
    globalThis.fetch = (async (_input: RequestInfo | URL) =>
      new Response(JSON.stringify({ models: names.map((name) => ({ name })) }), { status: 200 })) as typeof fetch;
    return () => {
      globalThis.fetch = real;
    };
  };

  it("untagged model matches its :latest tag; absent model resolves undefined", async () => {
    const restore = stubTags(["nimble:latest"]);
    try {
      expect((await probeAutoShadow({ baseUrl: "http://fake.invalid" }))?.model).toBe("nimble");
      expect(await probeAutoShadow({ baseUrl: "http://fake.invalid", model: "clef" })).toBeUndefined();
    } finally {
      restore();
    }
  });

  it("malformed /api/tags body resolves undefined", async () => {
    const real = globalThis.fetch;
    globalThis.fetch = (async (_input: RequestInfo | URL) => new Response("{}", { status: 200 })) as typeof fetch;
    try {
      expect(await probeAutoShadow({ baseUrl: "http://fake.invalid" })).toBeUndefined();
    } finally {
      globalThis.fetch = real;
    }
  });

  it("unreachable server resolves to undefined (never throws)", async () => {
    setEnv("REACTIVE_AGENTS_NO_AUTO_SHADOW", undefined);
    setEnv("OLLAMA_ENDPOINT", "http://127.0.0.1:1");
    setEnv("OLLAMA_HOST", undefined);
    setEnv("OLLAMA_BASE", undefined);
    expect(await probeAutoShadow()).toBeUndefined();
  });

  it("live: reachable Ollama yields the ollama backend", async () => {
    if (process.env.REACTIVE_AGENTS_RUN_LIVE_OLLAMA_TESTS !== "1") return;
    setEnv("REACTIVE_AGENTS_NO_AUTO_SHADOW", undefined);
    setEnv("OLLAMA_ENDPOINT", undefined);
    setEnv("OLLAMA_HOST", undefined);
    setEnv("OLLAMA_BASE", undefined);
    const found = await probeAutoShadow();
    expect(found?.backend).toBe("ollama");
  });
});
