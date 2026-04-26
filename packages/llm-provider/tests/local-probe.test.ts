// Run: bun test packages/llm-provider/tests/local-probe.test.ts --timeout 15000
//
// Phase 1 S2.4 (lifted from Sprint 2 plan to ship immediately) — probe-on-
// first-use path. Pins the /api/show response → Capability translation
// without depending on a live Ollama daemon (uses fetch mock).

import { describe, it, expect, mock, afterEach } from "bun:test";
import { _resetProbeCacheForTesting } from "../src/providers/local-probe.js";

afterEach(() => {
  _resetProbeCacheForTesting();
});

// Fixture mirrors the actual /api/show response from `gemma4:e4b` 2026-04-25
const GEMMA4_SHOW_FIXTURE = {
  capabilities: ["completion", "vision", "audio", "tools", "thinking"],
  details: {
    family: "gemma4",
    families: ["gemma4"],
    parameter_size: "8.0B",
    parent_model: "",
    quantization_level: "Q4_K_M",
    format: "gguf",
  },
  model_info: {
    "gemma4.context_length": 131072,
    "gemma4.attention.head_count": 16,
  },
  parameters: "temperature                    1\ntop_k                          64",
  template: "{{- range $i, $_ := .Messages }}...",
};

describe("Ollama capability probe (S2.4)", () => {
  it("extracts context_length, capabilities, family from /api/show response", async () => {
    const fetchMock = mock(async () =>
      new Response(JSON.stringify(GEMMA4_SHOW_FIXTURE), { status: 200 }),
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    try {
      const { probeOllamaCapability } = await import("../src/providers/local-probe.js");
      const cap = await probeOllamaCapability("gemma4:e4b", "http://localhost:11434");
      expect(cap).not.toBeNull();
      expect(cap!.provider).toBe("ollama");
      expect(cap!.model).toBe("gemma4:e4b");
      expect(cap!.maxContextTokens).toBe(131072);
      // Recommended num_ctx capped at 32K even though model supports 128K
      // (local GPU memory is the real constraint; users override per-request).
      expect(cap!.recommendedNumCtx).toBe(32_768);
      expect(cap!.supportsVision).toBe(true);
      expect(cap!.supportsThinkingMode).toBe(true);
      expect(cap!.supportsStreamingToolCalls).toBe(true);
      expect(cap!.toolCallDialect).toBe("native-fc");
      expect(cap!.source).toBe("probe");
    } finally {
      globalThis.fetch = originalFetch;
    }
  }, 15000);

  it("returns null when /api/show responds with non-2xx", async () => {
    const fetchMock = mock(async () => new Response("not found", { status: 404 }));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    try {
      const { probeOllamaCapability } = await import("../src/providers/local-probe.js");
      const cap = await probeOllamaCapability("nonexistent:v1", "http://localhost:11434");
      expect(cap).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  }, 15000);

  it("returns null on fetch error (network down, timeout, etc.)", async () => {
    const fetchMock = mock(async () => {
      throw new Error("connection refused");
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    try {
      const { probeOllamaCapability } = await import("../src/providers/local-probe.js");
      const cap = await probeOllamaCapability("anything:v1", "http://localhost:99999");
      expect(cap).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  }, 15000);

  it("caches the probe result — second call hits the in-process cache, not the network", async () => {
    let callCount = 0;
    const fetchMock = mock(async () => {
      callCount++;
      return new Response(JSON.stringify(GEMMA4_SHOW_FIXTURE), { status: 200 });
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    try {
      const { probeOllamaCapability } = await import("../src/providers/local-probe.js");
      await probeOllamaCapability("gemma4:e4b", "http://localhost:11434");
      await probeOllamaCapability("gemma4:e4b", "http://localhost:11434");
      await probeOllamaCapability("gemma4:e4b", "http://localhost:11434");
      expect(callCount).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }, 15000);

  it("falls back to context_length=8192 when /api/show response lacks the .context_length key", async () => {
    const noContextLength = {
      ...GEMMA4_SHOW_FIXTURE,
      model_info: { "gemma4.attention.head_count": 16 },
    };
    const fetchMock = mock(async () =>
      new Response(JSON.stringify(noContextLength), { status: 200 }),
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    try {
      const { probeOllamaCapability } = await import("../src/providers/local-probe.js");
      const cap = await probeOllamaCapability("legacy-model:v0", "http://localhost:11434");
      expect(cap!.maxContextTokens).toBe(8192);
      expect(cap!.recommendedNumCtx).toBe(8192);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }, 15000);

  it("translates capabilities array to boolean fields correctly", async () => {
    const completionOnly = {
      ...GEMMA4_SHOW_FIXTURE,
      capabilities: ["completion"], // no tools, no vision, no thinking
    };
    const fetchMock = mock(async () =>
      new Response(JSON.stringify(completionOnly), { status: 200 }),
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    try {
      const { probeOllamaCapability } = await import("../src/providers/local-probe.js");
      const cap = await probeOllamaCapability("text-only:v1", "http://localhost:11434");
      expect(cap!.supportsVision).toBe(false);
      expect(cap!.supportsThinkingMode).toBe(false);
      expect(cap!.supportsStreamingToolCalls).toBe(false);
      expect(cap!.toolCallDialect).toBe("none");
    } finally {
      globalThis.fetch = originalFetch;
    }
  }, 15000);
});
