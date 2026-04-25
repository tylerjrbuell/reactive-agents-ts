// Run: bun test packages/reactive-intelligence/tests/calibration/capability-persistence.test.ts --timeout 15000
//
// Phase 1 Sprint 1 S1.2 — Capability persistence in CalibrationStore.
// The store now holds two kinds: ModelCalibration (entropy thresholds) and
// Capability (per-(provider, model) descriptors). Probed capabilities cache
// to disk so subsequent runs avoid re-probing.

import { describe, it, expect, afterAll } from "bun:test";
import { unlinkSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CalibrationStore } from "../../src/calibration/calibration-store.js";
import type { Capability } from "@reactive-agents/llm-provider";

const tmp = mkdtempSync(join(tmpdir(), "calstore-cap-"));
const onDiskPath = join(tmp, "calibration.db");

afterAll(() => {
  // Best-effort cleanup; SQLite WAL files are also cleaned by Bun on process exit
  for (const f of [onDiskPath, `${onDiskPath}-wal`, `${onDiskPath}-shm`]) {
    if (existsSync(f)) unlinkSync(f);
  }
});

const sampleCapability = (): Capability => ({
  provider: "ollama",
  model: "cogito:14b",
  tier: "local",
  maxContextTokens: 32_768,
  recommendedNumCtx: 8192,
  maxOutputTokens: 4096,
  tokenizerFamily: "llama",
  supportsPromptCaching: false,
  supportsVision: false,
  supportsThinkingMode: false,
  supportsStreamingToolCalls: true,
  toolCallDialect: "native-fc",
  source: "probe",
});

describe("CalibrationStore Capability persistence (S1.2)", () => {
  it("loadCapability returns null when nothing saved for that key", () => {
    const store = new CalibrationStore(":memory:");
    expect(store.loadCapability("ollama", "never-saved:v1")).toBeNull();
  });

  it("saveCapability + loadCapability round-trips identity", () => {
    const store = new CalibrationStore(":memory:");
    const original = sampleCapability();
    store.saveCapability(original);
    const loaded = store.loadCapability(original.provider, original.model);
    expect(loaded).toEqual(original);
  });

  it("saveCapability is idempotent (UPSERT semantics)", () => {
    const store = new CalibrationStore(":memory:");
    const original = sampleCapability();
    store.saveCapability(original);
    // Second save with same key should overwrite, not duplicate
    const updated: Capability = { ...original, recommendedNumCtx: 16_384, source: "probe" };
    store.saveCapability(updated);
    const loaded = store.loadCapability(original.provider, original.model);
    expect(loaded?.recommendedNumCtx).toBe(16_384);
  });

  it("two distinct (provider, model) pairs persist independently", () => {
    const store = new CalibrationStore(":memory:");
    const cap1: Capability = { ...sampleCapability(), provider: "ollama", model: "cogito:14b" };
    const cap2: Capability = { ...sampleCapability(), provider: "ollama", model: "qwen3:14b" };
    store.saveCapability(cap1);
    store.saveCapability(cap2);
    expect(store.loadCapability("ollama", "cogito:14b")?.model).toBe("cogito:14b");
    expect(store.loadCapability("ollama", "qwen3:14b")?.model).toBe("qwen3:14b");
  });

  it("on-disk capabilities persist across CalibrationStore re-open (cache survives restart)", () => {
    const cap = sampleCapability();
    {
      const store = new CalibrationStore(onDiskPath);
      store.saveCapability(cap);
    }
    {
      const store = new CalibrationStore(onDiskPath);
      const loaded = store.loadCapability(cap.provider, cap.model);
      expect(loaded).toEqual(cap);
    }
  });

  it("capability persistence does not collide with calibration persistence (separate tables)", () => {
    const store = new CalibrationStore(":memory:");
    const cap = sampleCapability();
    store.saveCapability(cap);
    // The legacy calibrations table for the same modelId has different columns
    // and should not be touched by saveCapability — load() returns null when
    // no calibration row exists, even though a capability row does.
    expect(store.load("cogito:14b")).toBeNull();
  });

  it("saveCapability accepts all valid Capability shapes", () => {
    const store = new CalibrationStore(":memory:");
    const variants: Capability[] = [
      { ...sampleCapability(), source: "probe" },
      { ...sampleCapability(), source: "static-table", provider: "anthropic", model: "claude-haiku-4-5-20251001", tier: "mid" },
      { ...sampleCapability(), source: "fallback", provider: "unknown", model: "unknown", tier: "local", maxContextTokens: 4096, recommendedNumCtx: 2048, supportsStreamingToolCalls: false, toolCallDialect: "none" },
    ];
    for (const v of variants) {
      store.saveCapability(v);
      const loaded = store.loadCapability(v.provider, v.model);
      expect(loaded).toEqual(v);
    }
  });
});
