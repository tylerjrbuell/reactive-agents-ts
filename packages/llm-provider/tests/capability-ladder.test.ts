// packages/llm-provider/tests/capability-ladder.test.ts
// Run: bun test packages/llm-provider/tests/capability-ladder.test.ts --timeout 15000
//
// Wave 2a (2026-10-13) — capability probe ladder extensions:
//   1. /api/show parsing: parameter_size → billions, chat-template tool-token
//      emission detection, thinking capability on the Capability record.
//   2. CalibrationStore write-through (the deferred S2.4 persistence): probe
//      results persist per (provider, model); the process-Map cache collapses
//      onto the store (memory → store → probe, write-through both).
//   3. supportsToolCalling derivation (Area 2) — see derive-support file
//      covered in local-tool-calling-claim.test.ts.
//
// Live Ollama opt-in:
//   REACTIVE_AGENTS_RUN_LIVE_OLLAMA_TESTS=1 bun test packages/llm-provider/tests/capability-ladder.test.ts --timeout 60000

import { describe, it, test, expect, mock, afterEach, beforeEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Schema } from "effect";
import {
  probeOllamaCapability,
  _resetProbeCacheForTesting,
} from "../src/providers/local-probe.js";
import {
  setCapabilityStoreDirForTesting,
  getCapabilityStore,
  setCapabilityStore,
} from "../src/capability-store.js";
import { _resetProbedRegistryForTesting } from "../src/capability-resolver.js";
import { CapabilitySchema } from "../src/capability.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

// Qwen3-style Go template that DOES render tool calls (mentions ToolCalls +
// the literal "tool_call" token).
const TOOL_TEMPLATE = [
  "{{- range $i, $_ := .Messages }}",
  "{{- if eq .Role \"tool\" }}",
  "<|tool|>{{ .Content }}<|end|>",
  "{{- else if .ToolCalls }}",
  'tool_call: {{"name": .Function.Name}}',
  "{{- end }}",
  "{{- end }}",
].join("\n");

// Granite-style template: renders only role/content, never tool tokens.
const NO_TOOL_TEMPLATE = [
  "{{- range $i, $_ := .Messages }}",
  "<|start|>{{ .Role | title }}<|split|>",
  "{{ .Content }}<|end|>",
  "{{- end }}",
].join("\n");

function qwenFixture(
  template: string | undefined,
  parameterSize: string,
  capabilities: readonly string[],
) {
  return {
    model: "test-model",
    capabilities,
    details: {
      family: "qwen3",
      parameter_size: parameterSize,
      quantization_level: "Q4_K_M",
    },
    model_info: { "qwen3.context_length": 40_960 },
    ...(template !== undefined ? { template } : {}),
  };
}

/** Install a fetch mock serving the given /api/show payload; returns a restore fn. */
function mockShowResponse(payload: unknown): () => void {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = mock(async () => {
    fetchCount++;
    return new Response(JSON.stringify(payload), { status: 200 });
  }) as unknown as typeof globalThis.fetch;
  const restore = () => {
    globalThis.fetch = originalFetch;
  };
  return restore;
}

let storeDir: string;

beforeEach(() => {
  // Every test gets a fresh temp dir so the file store starts empty.
  storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ra-cap-store-test-"));
  setCapabilityStoreDirForTesting(storeDir);
});

afterEach(() => {
  _resetProbeCacheForTesting();
  _resetProbedRegistryForTesting();
  setCapabilityStore(null);
  setCapabilityStoreDirForTesting(null);
  fs.rmSync(storeDir, { recursive: true, force: true });
});

describe("probe ladder — parameter_size / thinking / tool-template emission", () => {
  it("parses fractional parameter_size like '1.7B' into billions", async () => {
    const restore = mockShowResponse(
      qwenFixture(TOOL_TEMPLATE, "1.7B", ["completion", "tools", "thinking"]),
    );
    try {
      const cap = await probeOllamaCapability("size-test:1.7b", "http://localhost:11434");
      expect(cap).not.toBeNull();
      expect(cap!.parameterSizeBillions).toBeCloseTo(1.7, 5);
      expect(cap!.supportsThinkingMode).toBe(true);
    } finally {
      restore();
    }
  }, 15_000);

  it("parses integer and multi-digit parameter_size ('8B', '8.0B', '120B')", async () => {
    const cases: ReadonlyArray<readonly [string, number]> = [
      ["8B", 8],
      ["8.0B", 8],
      ["120B", 120],
    ];
    for (const [size, expected] of cases) {
      const restore = mockShowResponse(qwenFixture(TOOL_TEMPLATE, size, ["completion"]));
      try {
        const cap = await probeOllamaCapability(`size-int-${expected}b:v1`, "http://localhost:11434");
        expect(cap!.parameterSizeBillions).toBe(expected);
      } finally {
        restore();
      }
    }
  }, 15_000);

  it("leaves parameterSizeBillions undefined for unparseable size strings", async () => {
    const restore = mockShowResponse(qwenFixture(TOOL_TEMPLATE, "unknown", ["completion"]));
    try {
      const cap = await probeOllamaCapability("size-bad:v1", "http://localhost:11434");
      expect(cap!.parameterSizeBillions).toBeUndefined();
    } finally {
      restore();
    }
  }, 15_000);

  it("detects tool-token emission from a tool-aware chat template", async () => {
    const restore = mockShowResponse(
      qwenFixture(TOOL_TEMPLATE, "8.0B", ["completion", "tools"]),
    );
    try {
      const cap = await probeOllamaCapability("emit-yes:v1", "http://localhost:11434");
      expect(cap!.toolTemplateEmitsTokens).toBe(true);
      // thinking absent from capabilities array → measured false, not undefined
      expect(cap!.supportsThinkingMode).toBe(false);
    } finally {
      restore();
    }
  }, 15_000);

  it("detects NO tool-token emission from a plain template", async () => {
    const restore = mockShowResponse(qwenFixture(NO_TOOL_TEMPLATE, "3.0B", ["completion"]));
    try {
      const cap = await probeOllamaCapability("emit-no:v1", "http://localhost:11434");
      expect(cap!.toolTemplateEmitsTokens).toBe(false);
    } finally {
      restore();
    }
  }, 15_000);

  it("leaves toolTemplateEmitsTokens undefined when /api/show returns no template", async () => {
    const restore = mockShowResponse(
      qwenFixture(undefined, "3.0B", ["completion", "tools"]),
    );
    try {
      const cap = await probeOllamaCapability("no-template:v1", "http://localhost:11434");
      expect(cap!.toolTemplateEmitsTokens).toBeUndefined();
    } finally {
      restore();
    }
  }, 15_000);
});

describe("CalibrationStore write-through (deferred S2.4 persistence)", () => {
  it("persists a probe result; a cold in-memory cache re-reads it from the store without hitting the network", async () => {
    const restore = mockShowResponse(
      qwenFixture(TOOL_TEMPLATE, "4.0B", ["completion", "tools", "thinking"]),
    );
    try {
      const first = await probeOllamaCapability("persist-me:v1", "http://localhost:11434");
      expect(first).not.toBeNull();
      expect(first!.toolTemplateEmitsTokens).toBe(true);
    } finally {
      restore();
    }

    // Simulate a fresh process: wipe the in-memory Map only — the store file
    // survives. The next probe call must be served from the STORE.
    _resetProbeCacheForTesting();
    const restore2 = mockShowResponse(qwenFixture(NO_TOOL_TEMPLATE, "999B", []));
    try {
      const second = await probeOllamaCapability("persist-me:v1", "http://localhost:11434");
      expect(second).not.toBeNull();
      expect(second!.model).toBe("persist-me:v1");
      // Original probe values — not the decoy fixture above.
      expect(second!.toolTemplateEmitsTokens).toBe(true);
      expect(second!.parameterSizeBillions).toBe(4);
    } finally {
      restore2();
    }
  }, 15_000);

  it("store file decodes cleanly through the CapabilitySchema (no corrupt rows)", async () => {
    const restore = mockShowResponse(
      qwenFixture(TOOL_TEMPLATE, "8.0B", ["completion", "tools"]),
    );
    try {
      await probeOllamaCapability("schema-ok:v1", "http://localhost:11434");
    } finally {
      restore();
    }
    const files = fs.readdirSync(storeDir).filter((f) => f.endsWith(".json"));
    expect(files.length).toBe(1);
    const raw = JSON.parse(fs.readFileSync(path.join(storeDir, files[0]!), "utf-8"));
    const decoded = Schema.decodeUnknownSync(CapabilitySchema)(raw);
    expect(decoded.model).toBe("schema-ok:v1");
    expect(decoded.toolTemplateEmitsTokens).toBe(true);
  }, 15_000);

  it("an injected store (duck-typed CapabilityCache, e.g. CalibrationStore) receives write-through", async () => {
    const saved: string[] = [];
    const builtin = getCapabilityStore();
    setCapabilityStore({
      loadCapability: (provider: string, model: string) =>
        builtin.loadCapability(provider, model),
      saveCapability: (cap) => {
        saved.push(cap.model);
        builtin.saveCapability(cap);
      },
    });
    const restore = mockShowResponse(
      qwenFixture(TOOL_TEMPLATE, "8.0B", ["completion", "tools"]),
    );
    try {
      await probeOllamaCapability("injected:v1", "http://localhost:11434");
    } finally {
      restore();
    }
    expect(saved).toEqual(["injected:v1"]);
    expect(builtin.loadCapability("ollama", "injected:v1")).not.toBeNull();
  }, 15_000);

  it("a corrupt store row is ignored and re-probed (store never returns garbage)", async () => {
    // Seed a valid probe first.
    const restore = mockShowResponse(
      qwenFixture(TOOL_TEMPLATE, "2.0B", ["completion", "tools"]),
    );
    try {
      await probeOllamaCapability("corrupt:v1", "http://localhost:11434");
    } finally {
      restore();
    }
    _resetProbeCacheForTesting();
    // Overwrite the file with garbage.
    const files = fs.readdirSync(storeDir).filter((f) => f.endsWith(".json"));
    for (const f of files) {
      fs.writeFileSync(path.join(storeDir, f), "{ not json !!");
    }
    const restore2 = mockShowResponse(qwenFixture(TOOL_TEMPLATE, "2.0B", ["completion", "tools"]));
    try {
      const cap = await probeOllamaCapability("corrupt:v1", "http://localhost:11434");
      expect(cap).not.toBeNull(); // re-probed, not poisoned by the bad row
    } finally {
      restore2();
    }
  }, 15_000);
});

// ─── Live opt-in arm (auto-skips without REACTIVE_AGENTS_RUN_LIVE_OLLAMA_TESTS=1) ───

const liveEnabled = process.env.REACTIVE_AGENTS_RUN_LIVE_OLLAMA_TESTS === "1";

test.skipIf(!liveEnabled)(
  "live: real /api/show probe fills size + thinking + template emission fields",
  async () => {
    const res = await fetch("http://localhost:11434/api/tags", {
      signal: AbortSignal.timeout(1500),
    }).catch(() => null);
    if (!res?.ok) return; // server not reachable — nothing to assert
    const body = (await res.json()) as { models?: Array<{ name: string }> };
    const model = (body.models ?? []).map((m) => m.name).find((n) => !n.includes("embed"));
    if (!model) return;
    _resetProbeCacheForTesting();
    const cap = await probeOllamaCapability(model, "http://localhost:11434");
    expect(cap).not.toBeNull();
    expect(typeof cap!.supportsThinkingMode).toBe("boolean");
    if (cap!.toolTemplateEmitsTokens !== undefined) {
      expect(typeof cap!.toolTemplateEmitsTokens).toBe("boolean");
    }
    if (cap!.parameterSizeBillions !== undefined) {
      expect(cap!.parameterSizeBillions).toBeGreaterThan(0);
    }
  },
  30_000,
);
