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

/**
 * Install a fetch mock serving the given /api/show payload. Returns the
 * restore fn plus a live counter (asserting store hits require knowing
 * whether the network was touched).
 */
function mockShowResponse(payload: unknown | (() => unknown)): {
  restore: () => void
  calls: () => number
} {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = mock(async () => {
    fetchCount++;
    const body = typeof payload === "function" ? (payload as () => unknown)() : payload;
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof globalThis.fetch;
  return {
    restore: () => {
      globalThis.fetch = originalFetch;
    },
    calls: () => fetchCount,
  };
}

let storeDir: string;
let storeDirRoot: string;

beforeEach(() => {
  // Private parent dir: `..`-escape assertions must look INSIDE this dir
  // (worst case an escape writes here), never at the shared /tmp namespace.
  storeDirRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ra-cap-store-"));
  storeDir = path.join(storeDirRoot, "store");
  setCapabilityStoreDirForTesting(storeDir);
});

afterEach(() => {
  _resetProbeCacheForTesting();
  _resetProbedRegistryForTesting();
  setCapabilityStore(null);
  setCapabilityStoreDirForTesting(null);
  fs.rmSync(storeDirRoot, { recursive: true, force: true });
});

describe("probe ladder — parameter_size / thinking / tool-template emission", () => {
  it("parses fractional parameter_size like '1.7B' into billions", async () => {
    const { restore } = mockShowResponse(
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
      const { restore } = mockShowResponse(qwenFixture(TOOL_TEMPLATE, size, ["completion"]));
      try {
        const cap = await probeOllamaCapability(`size-int-${expected}b:v1`, "http://localhost:11434");
        expect(cap!.parameterSizeBillions).toBe(expected);
      } finally {
        restore();
      }
    }
  }, 15_000);

  it("leaves parameterSizeBillions undefined for unparseable size strings", async () => {
    const { restore } = mockShowResponse(qwenFixture(TOOL_TEMPLATE, "unknown", ["completion"]));
    try {
      const cap = await probeOllamaCapability("size-bad:v1", "http://localhost:11434");
      expect(cap!.parameterSizeBillions).toBeUndefined();
    } finally {
      restore();
    }
  }, 15_000);

  it("detects tool-token emission from a tool-aware chat template", async () => {
    const { restore } = mockShowResponse(
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
    const { restore } = mockShowResponse(qwenFixture(NO_TOOL_TEMPLATE, "3.0B", ["completion"]));
    try {
      const cap = await probeOllamaCapability("emit-no:v1", "http://localhost:11434");
      expect(cap!.toolTemplateEmitsTokens).toBe(false);
    } finally {
      restore();
    }
  }, 15_000);

  it("leaves toolTemplateEmitsTokens undefined when /api/show returns no template", async () => {
    const { restore } = mockShowResponse(
      qwenFixture(undefined, "3.0B", ["completion", "tools"]),
    );
    try {
      const cap = await probeOllamaCapability("no-template:v1", "http://localhost:11434");
      expect(cap!.toolTemplateEmitsTokens).toBeUndefined();
    } finally {
      restore();
    }
  }, 15_000);

  it("detects function_call-era templates (W2a review fix 1: no stranding false)", async () => {
    // Old ChatML/OpenAI-style tool rendering seen in converted GGUF templates:
    // renders .FunctionCall + the literal "function_call" token but NO
    // "tool_call" text. Must measure TRUE — a false here would strand a
    // genuinely tool-capable model at strict-false (Review Focus #2 class).
    const FUNCTION_CALL_TEMPLATE = [
      "{{- range .Messages }}",
      "{{- if .FunctionCall }}",
      'function_call: {"name": {{.FunctionCall.Name}}, "arguments": {{.FunctionCall.Arguments}}}',
      "{{- else }}",
      "{{ .Content }}",
      "{{- end }}",
      "{{- end }}",
    ].join("\n");
    const { restore } = mockShowResponse(
      qwenFixture(FUNCTION_CALL_TEMPLATE, "7.0B", ["completion", "tools"]),
    );
    try {
      const cap = await probeOllamaCapability("function-call-era:v1", "http://localhost:11434");
      expect(cap!.toolTemplateEmitsTokens).toBe(true);
    } finally {
      restore();
    }

    // Bare `.FunctionCall` access (no literal token text) must also measure true.
    const { restore: restore2 } = mockShowResponse(
      qwenFixture(
        '{{- if ne .FunctionCall "" }}<tool>{{ .FunctionCall }}</tool>{{- end }}',
        "7.0B",
        ["completion", "tools"],
      ),
    );
    try {
      const cap = await probeOllamaCapability("fn-call-accessor:v1", "http://localhost:11434");
      expect(cap!.toolTemplateEmitsTokens).toBe(true);
    } finally {
      restore2();
    }
  }, 15_000);
});

describe("CalibrationStore write-through (deferred S2.4 persistence)", () => {
  it("persists a probe result; a cold in-memory cache re-reads it from the store without hitting the network", async () => {
    const { restore } = mockShowResponse(
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
    const { restore: restore2 } = mockShowResponse(qwenFixture(NO_TOOL_TEMPLATE, "999B", []));
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
    const { restore } = mockShowResponse(
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
      loadCapability: (provider: string, model: string, endpoint?: string) =>
        builtin.loadCapability(provider, model, endpoint),
      saveCapability: (cap, endpoint) => {
        saved.push(cap.model);
        builtin.saveCapability(cap, endpoint);
      },
    });
    const { restore } = mockShowResponse(
      qwenFixture(TOOL_TEMPLATE, "8.0B", ["completion", "tools"]),
    );
    try {
      await probeOllamaCapability("injected:v1", "http://localhost:11434");
    } finally {
      restore();
    }
    expect(saved).toEqual(["injected:v1"]);
    expect(
      builtin.loadCapability("ollama", "injected:v1", "http://localhost:11434"),
    ).not.toBeNull();
  }, 15_000);

  it("a corrupt store row is ignored and re-probed (store never returns garbage)", async () => {
    // Seed a valid probe first.
    const { restore } = mockShowResponse(
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
    const { restore: restore2 } = mockShowResponse(qwenFixture(TOOL_TEMPLATE, "2.0B", ["completion", "tools"]));
    try {
      const cap = await probeOllamaCapability("corrupt:v1", "http://localhost:11434");
      expect(cap).not.toBeNull(); // re-probed, not poisoned by the bad row
    } finally {
      restore2();
    }
  }, 15_000);
});

// ─── W2a review fix 2: store rows are baseUrl-scoped ─────────────────────────

describe("capability store — baseUrl-scoped rows (W2a review fix 2)", () => {
  it("two endpoints serving the same tag never cross-serve rows", async () => {
    const fixtureA = qwenFixture(TOOL_TEMPLATE, "2.0B", ["completion", "tools"]);
    const fixtureB = qwenFixture(TOOL_TEMPLATE, "4.0B", ["completion", "tools"]);
    const { restore: restoreA } = mockShowResponse(fixtureA);
    try {
      await probeOllamaCapability("dual-endpoint:v1", "http://localhost:11434");
    } finally {
      restoreA();
    }
    // Cold in-memory Map; second endpoint must NOT be served row A (it would
    // have the WRONG quantization-derived size if it were).
    _resetProbeCacheForTesting();
    const { restore: restoreB } = mockShowResponse(fixtureB);
    try {
      const capB = await probeOllamaCapability("dual-endpoint:v1", "http://otherbox:11435");
      expect(capB!.parameterSizeBillions).toBe(4); // endpoint B's own probe
    } finally {
      restoreB();
    }
    // And endpoint A still gets its OWN persisted row back without the network.
    _resetProbeCacheForTesting();
    const { restore: restoreGuard, calls } = mockShowResponse(fixtureB);
    try {
      const capA = await probeOllamaCapability("dual-endpoint:v1", "http://localhost:11434");
      expect(calls()).toBe(0); // served from A's endpoint-scoped store row
      expect(capA!.parameterSizeBillions).toBe(2);
    } finally {
      restoreGuard();
    }
  }, 15_000);

  it("legacy (endpoint-less) rows are treated as a miss and self-heal on next probe", async () => {
    // Plant a row at the OLD key format (provider-model, no endpoint suffix).
    fs.mkdirSync(storeDir, { recursive: true });
    fs.writeFileSync(
      path.join(storeDir, "ollama-legacy-tag-v1.json"),
      JSON.stringify(qwenFixture(NO_TOOL_TEMPLATE, "999B", [])), // decoy values
      "utf-8",
    );
    const { restore } = mockShowResponse(qwenFixture(TOOL_TEMPLATE, "1.7B", ["completion", "tools"]));
    try {
      const cap = await probeOllamaCapability("legacy-tag:v1", "http://localhost:11434");
      // The decoy row must NOT be served — fresh probe wins.
      expect(cap!.parameterSizeBillions).toBeCloseTo(1.7, 5);
    } finally {
      restore();
    }
    // New-format file exists; old-format row left orphaned (harmless).
    const files = fs.readdirSync(storeDir);
    expect(files.some((f) => f.startsWith("ollama-legacy-tag-v1-"))).toBe(true);
  }, 15_000);

  it("atomic write leaves no temp files behind (minor: torn-write prevention)", async () => {
    const { restore } = mockShowResponse(qwenFixture(TOOL_TEMPLATE, "8.0B", ["completion", "tools"]));
    try {
      await probeOllamaCapability("atomic:v1", "http://localhost:11434");
    } finally {
      restore();
    }
    const files = fs.readdirSync(storeDir);
    expect(files.filter((f) => f.endsWith(".tmp") || f.includes(".tmp-")).length).toBe(0);
    expect(files.filter((f) => f.endsWith(".json")).length).toBe(1);
  }, 15_000);

  it("model names cannot escape the store directory via / or .. (minor: key hardening)", async () => {
    const escapee = "evil/../../pwned:v1";
    const { restore } = mockShowResponse(qwenFixture(TOOL_TEMPLATE, "8.0B", ["completion", "tools"]));
    try {
      const cap = await probeOllamaCapability(escapee, "http://localhost:11434");
      expect(cap).not.toBeNull();
    } finally {
      restore();
    }
    // The escape attempt must have landed as ONE sanitized file inside the
    // store dir. The private parent (storeDirRoot) must be clean — an old
    // unsanitized implementation resolved `evil/../../pwned-v1.json` to
    // `../pwned-v1.json` relative to it and wrote OUTSIDE the store dir.
    const files = fs.readdirSync(storeDir);
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/^[a-z0-9-]+\.json$/);
    const siblings = fs.readdirSync(storeDirRoot).filter((f) => f !== "store");
    expect(siblings).toEqual([]);
  }, 15_000);
});

// ─── W2a review fix 3: test-disable seam ─────────────────────────────────────

describe("capability store — REACTIVE_AGENTS_CAPABILITY_STORE_DISABLE seam", () => {
  it("with the env seam set, the probe reads nothing and writes nothing (in-memory only)", async () => {
    process.env.REACTIVE_AGENTS_CAPABILITY_STORE_DISABLE = "1";
    try {
      const fixture = qwenFixture(TOOL_TEMPLATE, "8.0B", ["completion", "tools"]);
      const { restore, calls } = mockShowResponse(fixture);
      try {
        await probeOllamaCapability("disabled-write:v1", "http://localhost:11434");
        // Second call with a COLD memory cache must hit the network again —
        // proof that nothing was persisted to read back.
        _resetProbeCacheForTesting();
        await probeOllamaCapability("disabled-write:v1", "http://localhost:11434");
      } finally {
        restore();
      }
      expect(calls()).toBe(2);
      // No store directory was ever created (writes skipped entirely).
      expect(fs.existsSync(storeDir) ? fs.readdirSync(storeDir).length : 0).toBe(0);
    } finally {
      delete process.env.REACTIVE_AGENTS_CAPABILITY_STORE_DISABLE;
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
