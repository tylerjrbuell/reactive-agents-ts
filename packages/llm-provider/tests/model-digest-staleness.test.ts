// Run: bun test packages/llm-provider/tests/model-digest-staleness.test.ts --timeout 15000
//
// A re-pulled Ollama tag keeps its name but changes digest (campaign P2a:
// qwen3:4b 2bfd38a7daaf -> 359d7dd4bcda, median cell 33 s -> 55 s). Persisted
// records measured against the old weights must be flagged stale, never
// silently applied to the new model.

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Schema } from "effect";
import { probeOllamaCapability, _resetProbeCacheForTesting } from "../src/providers/local-probe.js";
import { setCapabilityStoreDirForTesting, makeFileCapabilityStore } from "../src/capability-store.js";
import { _resetProbedRegistryForTesting } from "../src/capability-resolver.js";
import { CapabilitySchema, CURRENT_PROBE_VERSION, type Capability } from "../src/capability.js";
import { ModelCalibrationSchema, loadCalibration, clearCalibrationCache } from "../src/calibration.js";
import {
  checkDigest,
  digestFromTagsBody,
  onModelDigestStale,
  registerLiveDigest,
  _resetLiveDigestsForTesting,
  type ModelDigestStaleEvent,
} from "../src/model-digest.js";
import { fetchStub } from "./helpers/fetch-stub.js";

const BASE = "http://localhost:11434";
const MODEL = "qwen3:4b";
const OLD = "2bfd38a7daaf";
const NEW = "359d7dd4bcda";

const show = {
  capabilities: ["completion", "tools"],
  details: { family: "qwen3", parameter_size: "4B" },
  model_info: { "qwen3.context_length": 40960 },
  template: "x".repeat(200),
};

/** Scripted Ollama: /api/show (no digest field) + /api/tags with a digest. */
function scriptOllama(tagsDigest: string | null): { restore: () => void; paths: string[] } {
  const original = globalThis.fetch;
  const paths: string[] = [];
  globalThis.fetch = fetchStub(async (input) => {
    const url = String(input);
    paths.push(new URL(url).pathname);
    if (url.endsWith("/api/tags")) {
      if (tagsDigest === null) return new Response("nope", { status: 500 });
      return new Response(JSON.stringify({ models: [{ name: MODEL, digest: tagsDigest }] }), { status: 200 });
    }
    return new Response(JSON.stringify(show), { status: 200 });
  });
  return { restore: () => (globalThis.fetch = original), paths };
}

function plantRow(dir: string, digest: string | undefined): Capability {
  const row: Capability = {
    provider: "ollama",
    model: MODEL,
    tier: "local",
    maxContextTokens: 1111,
    recommendedNumCtx: 1111,
    maxOutputTokens: 100,
    tokenizerFamily: "llama",
    supportsPromptCaching: false,
    supportsVision: false,
    supportsThinkingMode: false,
    supportsStreamingToolCalls: true,
    toolCallDialect: "native-fc",
    probeVersion: CURRENT_PROBE_VERSION,
    ...(digest !== undefined ? { digest } : {}),
    source: "probe",
  };
  makeFileCapabilityStore(dir).saveCapability(row, BASE);
  return row;
}

let root: string;
let storeDir: string;
const events: ModelDigestStaleEvent[] = [];
let unsubscribe: () => void;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "ra-digest-"));
  storeDir = path.join(root, "store");
  setCapabilityStoreDirForTesting(storeDir);
  events.length = 0;
  unsubscribe = onModelDigestStale((e) => events.push(e));
});

afterEach(() => {
  unsubscribe();
  _resetProbeCacheForTesting();
  _resetProbedRegistryForTesting();
  _resetLiveDigestsForTesting();
  clearCalibrationCache();
  setCapabilityStoreDirForTesting(null);
  fs.rmSync(root, { recursive: true, force: true });
});

describe("checkDigest (pure)", () => {
  it("fresh / stale / unknown", () => {
    expect(checkDigest(OLD, OLD).status).toBe("fresh");
    expect(checkDigest(OLD, NEW).status).toBe("stale");
    expect(checkDigest(undefined, NEW).status).toBe("unknown");
    expect(checkDigest(OLD, undefined).status).toBe("unknown");
  });
  it("parses /api/tags, matching implicit :latest", () => {
    const body = { models: [{ name: "llama3:latest", digest: "abc" }] };
    expect(digestFromTagsBody(body, "llama3")).toBe("abc");
    expect(digestFromTagsBody(body, "other")).toBeUndefined();
    expect(digestFromTagsBody("junk", "llama3")).toBeUndefined();
  });
});

describe("capability probe digest gate", () => {
  it("changed digest => stored row rejected, re-probed, row rewritten with new digest, event emitted", async () => {
    plantRow(storeDir, OLD);
    const s = scriptOllama(NEW);
    try {
      const cap = await probeOllamaCapability(MODEL, BASE);
      expect(cap?.maxContextTokens).toBe(40960); // live probe, not the planted 1111
      expect(cap?.digest).toBe(NEW);
      expect(s.paths).toContain("/api/show");
      expect(events).toEqual([
        { kind: "capability", provider: "ollama", model: MODEL, recordedDigest: OLD, liveDigest: NEW, action: "recalibrate" },
      ]);
      expect(makeFileCapabilityStore(storeDir).loadCapability("ollama", MODEL, BASE)?.digest).toBe(NEW);
    } finally {
      s.restore();
    }
  });

  it("same digest => stored row served, no re-probe, no event", async () => {
    plantRow(storeDir, OLD);
    const s = scriptOllama(OLD);
    try {
      const cap = await probeOllamaCapability(MODEL, BASE);
      expect(cap?.maxContextTokens).toBe(1111);
      expect(s.paths).not.toContain("/api/show");
      expect(events).toEqual([]);
    } finally {
      s.restore();
    }
  });

  it("row without digest => unchanged behavior (served, no digest lookup)", async () => {
    plantRow(storeDir, undefined);
    const s = scriptOllama(NEW);
    try {
      const cap = await probeOllamaCapability(MODEL, BASE);
      expect(cap?.maxContextTokens).toBe(1111);
      expect(s.paths).toEqual([]);
      expect(events).toEqual([]);
    } finally {
      s.restore();
    }
  });

  it("live digest unavailable => row served (unknown never invalidates)", async () => {
    plantRow(storeDir, OLD);
    const s = scriptOllama(null);
    try {
      const cap = await probeOllamaCapability(MODEL, BASE);
      expect(cap?.maxContextTokens).toBe(1111);
      expect(events).toEqual([]);
    } finally {
      s.restore();
    }
  });
});

describe("calibration digest gate", () => {
  const cal = {
    modelId: "digest-test:1b",
    calibratedAt: "2026-11-13T00:00:00.000Z",
    probeVersion: 3,
    runsAveraged: 3,
    steeringCompliance: "hybrid",
    parallelCallCapability: "partial",
    observationHandling: "uses-recall",
    systemPromptAttention: "strong",
    optimalToolResultChars: 1500,
  } as const;

  function withUserCal(digest: string | undefined, fn: () => void): void {
    const home = process.env.HOME;
    process.env.HOME = root;
    try {
      const dir = path.join(root, ".reactive-agents", "calibrations");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "digest-test-1b.json"),
        JSON.stringify({ ...cal, ...(digest !== undefined ? { digest } : {}) }),
      );
      clearCalibrationCache();
      fn();
    } finally {
      process.env.HOME = home;
    }
  }

  it("stale digest => tier defaults (undefined) + recalibrate event", () => {
    withUserCal(OLD, () => {
      registerLiveDigest("ollama", "digest-test:1b", NEW);
      expect(loadCalibration("digest-test:1b")).toBeUndefined();
      expect(events[0]?.kind).toBe("calibration");
      expect(events[0]?.action).toBe("recalibrate");
    });
  });

  it("matching digest => calibration applied", () => {
    withUserCal(OLD, () => {
      registerLiveDigest("ollama", "digest-test:1b", OLD);
      expect(loadCalibration("digest-test:1b")?.optimalToolResultChars).toBe(1500);
      expect(events).toEqual([]);
    });
  });

  it("no live digest, or no recorded digest => applied unchanged", () => {
    withUserCal(OLD, () => {
      expect(loadCalibration("digest-test:1b")).toBeDefined();
    });
    withUserCal(undefined, () => {
      registerLiveDigest("ollama", "digest-test:1b", NEW);
      expect(loadCalibration("digest-test:1b")).toBeDefined();
    });
  });
});

describe("back-compat decode", () => {
  it("old calibration JSON (incl. a stray scaffoldingLevel) and old capability rows decode", () => {
    const decoded = Schema.decodeUnknownSync(ModelCalibrationSchema)({
      modelId: "m",
      calibratedAt: "t",
      probeVersion: 1,
      runsAveraged: 1,
      steeringCompliance: "hybrid",
      parallelCallCapability: "partial",
      observationHandling: "uses-recall",
      systemPromptAttention: "strong",
      optimalToolResultChars: 1,
      scaffoldingLevel: 2,
    });
    expect(decoded.digest).toBeUndefined();
    const { digest: _d, ...legacyRow } = plantRow(storeDir, OLD);
    expect(Schema.decodeUnknownSync(CapabilitySchema)(legacyRow).digest).toBeUndefined();
  });
});
