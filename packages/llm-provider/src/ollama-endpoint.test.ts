// Run: bun test packages/llm-provider/src/ollama-endpoint.test.ts
//
// `OLLAMA_HOST` is the env var Ollama's own CLI and docs use. The framework read
// only `OLLAMA_ENDPOINT`, so an app that set the canonical name was silently
// ignored: the capability probe, the build-time connection check and the actual
// LLM call all went to localhost instead (2026-07-22, found dogfooding FORGE —
// its Docker config sets `OLLAMA_HOST: http://host.docker.internal:11434`, so
// inside the container every one of those hit nothing, the capability fell back
// to the conservative 2048/none entry, and `.withStrictValidation()` failed the
// build with a message about the MODEL rather than the endpoint).
import { describe, it, expect, afterEach } from "bun:test";
import { resolveOllamaEndpoint } from "./ollama-endpoint.js";

const VARS = ["OLLAMA_ENDPOINT", "OLLAMA_HOST", "OLLAMA_BASE"] as const;

afterEach(() => {
  for (const v of VARS) delete process.env[v];
});

describe("resolveOllamaEndpoint", () => {
  it("defaults to localhost", () => {
    expect(resolveOllamaEndpoint()).toBe("http://localhost:11434");
  });

  it("honours OLLAMA_HOST", () => {
    process.env.OLLAMA_HOST = "http://host.docker.internal:11434";
    expect(resolveOllamaEndpoint()).toBe("http://host.docker.internal:11434");
  });

  it("adds the scheme Ollama's own CLI convention omits", () => {
    // `OLLAMA_HOST=127.0.0.1:11434` is the documented form for `ollama serve`.
    process.env.OLLAMA_HOST = "127.0.0.1:11434";
    expect(resolveOllamaEndpoint()).toBe("http://127.0.0.1:11434");
  });

  it("prefers an explicit argument over every env var", () => {
    process.env.OLLAMA_HOST = "http://from-env:11434";
    expect(resolveOllamaEndpoint("http://explicit:11434")).toBe("http://explicit:11434");
  });

  it("prefers OLLAMA_ENDPOINT over OLLAMA_HOST (existing configs keep winning)", () => {
    process.env.OLLAMA_ENDPOINT = "http://endpoint:11434";
    process.env.OLLAMA_HOST = "http://host:11434";
    expect(resolveOllamaEndpoint()).toBe("http://endpoint:11434");
  });

  it("falls back to OLLAMA_BASE (the calibration runner's historical name)", () => {
    process.env.OLLAMA_BASE = "http://base:11434";
    expect(resolveOllamaEndpoint()).toBe("http://base:11434");
  });

  it("ignores blank values instead of resolving to an empty host", () => {
    process.env.OLLAMA_ENDPOINT = "   ";
    process.env.OLLAMA_HOST = "http://host:11434";
    expect(resolveOllamaEndpoint()).toBe("http://host:11434");
  });

  it("trims a trailing slash so callers can concatenate paths", () => {
    process.env.OLLAMA_HOST = "http://host:11434/";
    expect(resolveOllamaEndpoint()).toBe("http://host:11434");
  });
});
