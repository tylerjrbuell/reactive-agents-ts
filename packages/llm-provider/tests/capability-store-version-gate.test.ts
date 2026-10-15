// packages/llm-provider/tests/capability-store-version-gate.test.ts
// Run: bun test packages/llm-provider/tests/capability-store-version-gate.test.ts --timeout 15000
//
// Stale persisted probe rows must not pin a route (user bug: qwen3.5).
//
// The live store carried ~/.reactive-agents/capabilities/ollama-qwen3.5.json
// written by the W2a-era probe: `toolTemplateEmitsTokens:false` measured off
// a 13-char PLUGIN-STUB template. The #243 fix made that scan return
// UNMEASURED for stubs — but the store outlived the probe logic that wrote
// it, so the stale `false` kept demoting a capable model to text-parse
// forever (no re-probe, no staleness gate). Same class as #243's stale
// calibration priors: persisted measurement data must carry a producer
// version and stop being trusted when the producer evolves.
//
// Contract pinned here: the file store (and the probe read path) trust a
// `source:"probe"` row ONLY when its `probeVersion` equals
// CURRENT_PROBE_VERSION. Absent/legacy => treated as a MISS: the live
// /api/show re-probe runs, applies the current guards, and write-through
// self-heals the file. Legacy files are NOT deleted (self-heal on write).

import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { probeOllamaCapability, _resetProbeCacheForTesting } from "../src/providers/local-probe.js";
import {
  setCapabilityStoreDirForTesting,
  getCapabilityStore,
} from "../src/capability-store.js";
import { _resetProbedRegistryForTesting } from "../src/capability-resolver.js";
import { CURRENT_PROBE_VERSION, type Capability } from "../src/capability.js";
import { deriveSupportsToolCalling } from "../src/providers/local.js";

const BASE = "http://localhost:11434";

// The REAL qwen3.5 shape: 13-char plugin-stub template, card advertises tools.
const STUB_TEMPLATE = "{{ .Prompt }}";
const qwen35ShowResponse = {
  capabilities: ["completion", "vision", "tools", "thinking"],
  details: { family: "qwen3.5", parameter_size: "9.7B" },
  model_info: { "qwen3.5.context_length": 262_144 },
  template: STUB_TEMPLATE,
};

function mockShow(payload: unknown): { restore: () => void; calls: () => number } {
  const original = globalThis.fetch;
  let n = 0;
  globalThis.fetch = mock(async () => {
    n++;
    return new Response(JSON.stringify(payload), { status: 200 });
  }) as unknown as typeof globalThis.fetch;
  return { restore: () => (globalThis.fetch = original), calls: () => n };
}

/** Write a store row file directly (simulating an older probe's output). */
function plantRow(model: string, row: Record<string, unknown>): void {
  fs.mkdirSync(storeDir, { recursive: true });
  const key = `ollama-${model.toLowerCase().replace(/:/g, "-").replace(/[^a-z0-9-]/g, "-")}-http---localhost-11434.json`;
  // Sanitized endpoint suffix as capability-store rowFileName produces.
  fs.writeFileSync(path.join(storeDir, key), JSON.stringify(row), "utf-8");
}

let storeDirRoot: string;
let storeDir: string;

beforeEach(() => {
  storeDirRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ra-store-gate-"));
  storeDir = path.join(storeDirRoot, "store");
  setCapabilityStoreDirForTesting(storeDir);
});

afterEach(() => {
  _resetProbeCacheForTesting();
  _resetProbedRegistryForTesting();
  setCapabilityStoreDirForTesting(null);
  fs.rmSync(storeDirRoot, { recursive: true, force: true });
});

/** Legacy W2a-era row: NO probeVersion, stale measured false from the stub. */
function legacyRow(model: string): Record<string, unknown> {
  return {
    provider: "ollama",
    model,
    tier: "local",
    maxContextTokens: 262_144,
    recommendedNumCtx: 32_768,
    maxOutputTokens: 4096,
    tokenizerFamily: "unknown",
    supportsPromptCaching: false,
    supportsVision: true,
    supportsThinkingMode: true,
    supportsStreamingToolCalls: true,
    toolCallDialect: "native-fc",
    parameterSizeBillions: 9.7,
    toolTemplateEmitsTokens: false,
    source: "probe",
  };
}

describe("capability store — probe-version staleness gate", () => {
  it("arm 1: legacy row (no probeVersion) is NOT authoritative — store read misses", () => {
    plantRow("stale-gate:v1", legacyRow("stale-gate:v1"));
    // The stale row is in the FILE; simulate a fresh process (memory cold).
    _resetProbeCacheForTesting();
    expect(getCapabilityStore().loadCapability("ollama", "stale-gate:v1", BASE)).toBeNull();
  }, 15_000);

  it("arm 1b: probe path on a legacy row re-probes and the fresh row applies the stub guard (unmeasured, not false)", async () => {
    plantRow("stale-gate:v1", legacyRow("stale-gate:v1"));
    _resetProbeCacheForTesting();

    const m = mockShow(qwen35ShowResponse);
    try {
      const cap = await probeOllamaCapability("stale-gate:v1", BASE);
      expect(m.calls()).toBe(1); // legacy row did NOT short-circuit the probe
      expect(cap!.toolTemplateEmitsTokens).toBeUndefined(); // 13-char stub: UNMEASURED
      expect(cap!.probeVersion).toBe(CURRENT_PROBE_VERSION);
    } finally {
      m.restore();
    }

    // Self-heal: the re-probe write-through is now trusted (cold memory).
    _resetProbeCacheForTesting();
    const m2 = mockShow(qwen35ShowResponse);
    try {
      const cap2 = await probeOllamaCapability("stale-gate:v1", BASE);
      expect(m2.calls()).toBe(0); // healed row: no network
      expect(cap2!.toolTemplateEmitsTokens).toBeUndefined();
    } finally {
      m2.restore();
    }
  }, 15_000);

  it("arm 2: a CURRENT-probeVersion row IS authoritative — served without touching the network", async () => {
    const current: Capability = {
      provider: "ollama",
      model: "current-gate:v1",
      tier: "local",
      maxContextTokens: 40_960,
      recommendedNumCtx: 32_768,
      maxOutputTokens: 4096,
      tokenizerFamily: "llama",
      supportsPromptCaching: false,
      supportsVision: false,
      supportsThinkingMode: true,
      supportsStreamingToolCalls: true,
      toolCallDialect: "native-fc",
      parameterSizeBillions: 4,
      toolTemplateEmitsTokens: true,
      probeVersion: CURRENT_PROBE_VERSION,
      source: "probe",
    };
    plantRow("current-gate:v1", current as unknown as Record<string, unknown>);
    _resetProbeCacheForTesting();

    const m = mockShowResponseWith(qwen35ShowResponse);
    try {
      const cap = await probeOllamaCapability("current-gate:v1", BASE);
      expect(m.calls()).toBe(0);
      expect(cap!.toolTemplateEmitsTokens).toBe(true); // served from store as-is
    } finally {
      m.restore();
    }
  }, 15_000);

  it("arm 3: e2e — stale-false row + gated re-probe derives provisional-permissive (native), never the stale demotion", async () => {
    plantRow("qwen3.5-e2e", legacyRow("qwen3.5-e2e"));
    _resetProbeCacheForTesting();

    const m = mockShowResponseWith(qwen35ShowResponse);
    try {
      const cap = await probeOllamaCapability("qwen3.5-e2e", BASE);
      const claim = deriveSupportsToolCalling(cap!);
      // Stub template -> emission UNMEASURED -> arm 1 of the precedence:
      // permissive TRUE, PROVISIONAL (no calibration prior exists for this
      // model name). At HEAD this returned false from the stale row.
      expect(claim.supported).toBe(true);
      expect(claim.provisional).toBe(true);
      expect(claim.reason).toContain("unmeasured");
    } finally {
      m.restore();
    }
  }, 15_000);

  it("CURRENT_PROBE_VERSION is a number > 1 (legacy unmarked rows count as v0/stale)", () => {
    expect(typeof CURRENT_PROBE_VERSION).toBe("number");
    expect(CURRENT_PROBE_VERSION).toBeGreaterThanOrEqual(2);
  }, 15_000);
});

// mockShowResponseWith kept as an alias so the plant/read arms read cleanly.
function mockShowResponseWith(payload: unknown) {
  return mockShow(payload);
}
