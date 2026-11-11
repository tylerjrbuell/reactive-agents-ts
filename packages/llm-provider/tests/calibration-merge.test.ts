import { describe, it, expect, afterEach } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PROBE_FIELDS,
  mergeProbeCalibration,
  type MeasuredCalibration,
} from "../src/calibration-merge.js";
import { commitCalibration, measureCalibration } from "../src/calibration-runner.js";

// The committed qwen3:4b shape: probe fields plus actOrAnswer (its own A/B
// evidence), which the probes do not measure.
const COMMITTED = {
  modelId: "qwen3:4b",
  calibratedAt: "2026-10-15T01:30:14.880Z",
  probeVersion: 2,
  runsAveraged: 10,
  steeringCompliance: "hybrid",
  parallelCallCapability: "reliable",
  observationHandling: "uses-recall",
  systemPromptAttention: "strong",
  optimalToolResultChars: 2000,
  toolCallDialect: "native-fc",
  actOrAnswer: "retry",
  classifierReliability: "low",
  knownToolAliases: { search: "web-search" },
  knownParamAliases: { "web-search": { q: "query" } },
} as const;

const FULL: MeasuredCalibration = {
  modelId: "qwen3:4b",
  calibratedAt: "2026-11-11T00:00:00.000Z",
  probeVersion: 3,
  runsAveraged: 5,
  fields: {
    steeringCompliance: "system-prompt",
    parallelCallCapability: "partial",
    observationHandling: "needs-inline-facts",
    systemPromptAttention: "moderate",
    optimalToolResultChars: 4000,
    toolCallDialect: "none",
  },
};

describe("mergeProbeCalibration", () => {
  it("full measurement replaces probe fields and stamp, keeps unmeasured fields", () => {
    const r = mergeProbeCalibration(COMMITTED, FULL);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.stamped).toBe(true);
    expect(r.kept).toEqual([]);
    expect(r.calibration).toEqual({
      ...COMMITTED,
      ...FULL.fields,
      calibratedAt: FULL.calibratedAt,
      probeVersion: 3,
      runsAveraged: 5,
    });
    expect(r.calibration.actOrAnswer).toBe("retry");
    expect(r.calibration.classifierReliability).toBe("low");
    expect(r.calibration.knownToolAliases).toEqual({ search: "web-search" });
    expect(r.calibration.knownParamAliases).toEqual({ "web-search": { q: "query" } });
  });

  it("partial measurement updates only measured fields and keeps the provenance stamp", () => {
    const r = mergeProbeCalibration(COMMITTED, {
      ...FULL,
      fields: { steeringCompliance: "user-message", optimalToolResultChars: 8000 },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.stamped).toBe(false);
    expect(r.kept).toEqual([
      "parallelCallCapability",
      "observationHandling",
      "systemPromptAttention",
      "toolCallDialect",
    ]);
    expect(r.calibration).toEqual({
      ...COMMITTED,
      steeringCompliance: "user-message",
      optimalToolResultChars: 8000,
    });
  });

  it("keeps the committed modelId spelling", () => {
    const r = mergeProbeCalibration(COMMITTED, { ...FULL, modelId: "QWEN3:4B" });
    expect(r.ok && r.calibration.modelId).toBe("qwen3:4b");
  });

  it("no existing file: writes a complete measurement, refuses a partial one", () => {
    const full = mergeProbeCalibration(undefined, FULL);
    expect(full.ok).toBe(true);
    if (full.ok) {
      expect(Object.keys(full.calibration)).toEqual([
        "modelId",
        "calibratedAt",
        "probeVersion",
        "runsAveraged",
        ...PROBE_FIELDS,
      ]);
    }
    const partial = mergeProbeCalibration(undefined, {
      ...FULL,
      fields: { steeringCompliance: "hybrid" },
    });
    expect(partial.ok).toBe(false);
  });
});

describe("commitCalibration (the --commit write path)", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("merges into the existing JSON and keeps actOrAnswer", async () => {
    dir = mkdtempSync(join(tmpdir(), "cal-commit-"));
    const file = join(dir, "qwen3-4b.json");
    writeFileSync(file, JSON.stringify(COMMITTED, null, 2));

    const outcome = await commitCalibration(FULL, dir);
    expect(outcome).toEqual({ ok: true, path: file, stamped: true, kept: [] });
    const written = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    expect(written.actOrAnswer).toBe("retry");
    expect(written.classifierReliability).toBe("low");
    expect(written.knownToolAliases).toEqual({ search: "web-search" });
    expect(written.probeVersion).toBe(3);
    expect(written.steeringCompliance).toBe("system-prompt");
  });

  it("refuses a partial measurement with no existing file and writes nothing", async () => {
    dir = mkdtempSync(join(tmpdir(), "cal-commit-"));
    const outcome = await commitCalibration(
      { ...FULL, modelId: "new:model", fields: { toolCallDialect: "native-fc" } },
      dir,
    );
    expect(outcome.ok).toBe(false);
    expect(existsSync(join(dir, "new-model.json"))).toBe(false);
  });
});

describe("measureCalibration probe subset, timeout and progress", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // Object.assign carries fetch's static members, so the mock is a full `typeof fetch`.
  const mockFetch = (impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) =>
    Object.assign(impl, originalFetch);

  const reply = (content: string) =>
    new Response(JSON.stringify({ model: "m", message: { role: "assistant", content }, done: true }), {
      headers: { "Content-Type": "application/json" },
    });

  it("runs only the requested probes and reports progress per probe", async () => {
    globalThis.fetch = mockFetch(async () => reply("BLUE"));
    const seen: string[] = [];
    const m = await measureCalibration("m", {
      runs: 2,
      probes: ["toolCallDialect", "parallelCallCapability"],
      onProgress: (p) => seen.push(`${p.run}:${p.field}:${p.outcome}`),
    });
    expect(Object.keys(m.fields).sort()).toEqual(["parallelCallCapability", "toolCallDialect"]);
    expect(m.fields.toolCallDialect).toBe("none");
    expect(seen).toEqual([
      "1:parallelCallCapability:measured",
      "1:toolCallDialect:measured",
      "2:parallelCallCapability:measured",
      "2:toolCallDialect:measured",
    ]);
  });

  it("a probe past the per-probe timeout is cancelled and left unmeasured", async () => {
    let aborted = 0;
    globalThis.fetch = mockFetch(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          // Never answers; only the abort signal ends it.
          init?.signal?.addEventListener("abort", () => {
            aborted++;
            reject(init.signal?.reason);
          });
        }),
    );
    const outcomes: string[] = [];
    const m = await measureCalibration("m", {
      runs: 1,
      probes: ["parallelCallCapability"],
      probeTimeoutMs: 50,
      onProgress: (p) => outcomes.push(p.outcome),
    });
    // parallelCallCapability swallows request failures into "sequential-only";
    // the timeout must win over that fallback.
    expect(m.fields).toEqual({});
    expect(outcomes).toEqual(["timeout"]);
    expect(aborted).toBe(1);
  });
});
