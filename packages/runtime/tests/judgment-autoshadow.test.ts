// Run: bun test packages/runtime/tests/judgment-autoshadow.test.ts --timeout 30000
//
// Wave 7.1 auto-shadow probe: keyless-safe detection of a cheap local
// judgment backend. Opt-out env, unreachable server, or any error all resolve
// to undefined (no service, build proceeds unchanged) — never throws, never
// blocks a build.
import { describe, expect, it, afterEach } from "bun:test";
import { probeAutoShadow } from "../src/judgment-autoshadow.js";

const ENV_KEYS = ["REACTIVE_AGENTS_NO_AUTO_SHADOW", "OLLAMA_ENDPOINT", "OLLAMA_HOST", "OLLAMA_BASE"] as const;
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

describe("7.1 auto-shadow probe", () => {
  it("opt-out env short-circuits to undefined without probing", async () => {
    setEnv("REACTIVE_AGENTS_NO_AUTO_SHADOW", "1");
    setEnv("OLLAMA_ENDPOINT", "http://localhost:11434");
    expect(await probeAutoShadow()).toBeUndefined();
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
