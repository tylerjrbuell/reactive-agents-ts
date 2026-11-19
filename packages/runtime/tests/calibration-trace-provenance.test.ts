/**
 * Calibration trace provenance (adaptive-harness audit 2026-11-19, G1/F2):
 * `run-started.config.calibration` records the resolved calibration per field
 * (value + source) and the completion provenance line reports the true sources.
 * Observability only: nothing here changes what a run does.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { loadTrace } from "@reactive-agents/trace";
import { appendObservation, type RunObservation } from "@reactive-agents/reactive-intelligence";
import { ReactiveAgents } from "../src";
import { resolveCalibrationWithRecord } from "../src/engine/phases/agent-loop/setup/calibration";
import { provenanceSourcesOf } from "../src/engine/execute-completion-obs";
import type { CalibrationResolution } from "../src/engine/execute-calibration-record";

const ROOT = mkdtempSync(join(tmpdir(), "ra-cal-prov-"));
const PRIOR = {
  trace: process.env.REACTIVE_AGENTS_TRACE_DIR,
  obs: process.env.REACTIVE_AGENTS_OBSERVATIONS_DIR,
};
beforeAll(() => {
  process.env.REACTIVE_AGENTS_TRACE_DIR = ROOT;
  process.env.REACTIVE_AGENTS_OBSERVATIONS_DIR = join(ROOT, "obs");
});
afterAll(() => {
  if (PRIOR.trace === undefined) delete process.env.REACTIVE_AGENTS_TRACE_DIR;
  else process.env.REACTIVE_AGENTS_TRACE_DIR = PRIOR.trace;
  if (PRIOR.obs === undefined) delete process.env.REACTIVE_AGENTS_OBSERVATIONS_DIR;
  else process.env.REACTIVE_AGENTS_OBSERVATIONS_DIR = PRIOR.obs;
  rmSync(ROOT, { recursive: true, force: true });
});

const resolve = (model: string, calibration: "auto" | "skip", learned = false) =>
  Effect.runPromise(
    resolveCalibrationWithRecord({
      calibration,
      provider: "test",
      defaultModel: model,
      reactiveIntelligenceOptions: { learnedCalibration: learned },
    }),
  );

const obsRun: RunObservation = {
  at: "2026-04-15T00:00:00.000Z",
  parallelTurnCount: 0,
  totalTurnCount: 3,
  dialect: "native-fc",
  classifierRequired: [],
  classifierActuallyCalled: [],
  subagentInvoked: 0,
  subagentSucceeded: 0,
  argValidityRate: 1,
};

describe("resolveCalibrationWithRecord", () => {
  test("calibrated model: every field is 'shipped' with the probe version", async () => {
    const { resolution } = await resolve("gemma4:e4b", "auto");
    expect(resolution.mode).toBe("auto");
    expect(resolution.tiers).toEqual(["shipped"]);
    expect(resolution.probeVersion).toBeGreaterThan(0);
    expect(resolution.modelId).toBe("gemma4:e4b");
    expect(resolution.fields.toolCallDialect?.source).toBe("shipped");
    expect(typeof resolution.fields.toolCallDialect?.value).toBe("string");
  });

  test("uncalibrated model: unresolved, no fields (nothing was applied)", async () => {
    const { calibration, resolution } = await resolve("totally-unknown:model", "auto");
    expect(calibration).toBeUndefined();
    expect(resolution).toEqual({ mode: "unresolved", tiers: [], fields: {} });
  });

  test("skip is recorded as skip", async () => {
    const { resolution } = await resolve("gemma4:e4b", "skip");
    expect(resolution).toEqual({ mode: "skip", tiers: [], fields: {} });
  });

  test("learned observations are labelled 'learned' on the fields they changed", async () => {
    for (let i = 0; i < 5; i++) appendObservation("gemma4:e4b", obsRun, { baseDir: join(ROOT, "obs") });
    const { resolution } = await resolve("gemma4:e4b", "auto", true);
    expect(resolution.tiers).toContain("learned");
    expect(resolution.fields.parallelCallCapability?.source).toBe("learned");
    expect(resolution.fields.steeringCompliance?.source).toBe("shipped");
  });
});

describe("provenanceSourcesOf", () => {
  const rec = (tiers: CalibrationResolution["tiers"]): CalibrationResolution => ({ mode: "auto", tiers, fields: {} });
  test("maps true sources, includes community, no hardcoded prior-only", () => {
    expect(provenanceSourcesOf(rec(["shipped", "community", "learned"]))).toEqual(["prior", "community", "local"]);
    expect(provenanceSourcesOf(rec(["community"]))).toEqual(["community"]);
    expect(provenanceSourcesOf(rec(["shipped"]))).toEqual(["prior"]);
    expect(provenanceSourcesOf(undefined)).toEqual(["prior"]);
  });
});

describe("run-started.config.calibration", () => {
  const startedConfig = async (model: string, calibration: "auto" | "skip") => {
    const agent = await ReactiveAgents.create()
      .withTestScenario([{ text: "FINAL ANSWER: ok" }])
      .withModel(model)
      .withCalibration(calibration)
      .withReasoning({ defaultStrategy: "reactive" })
      .build();
    const result = await agent.run("provenance pin");
    await agent.dispose();
    const started = (await loadTrace(result.metadata.tracePath!)).events.find((e) => e.kind === "run-started");
    if (started?.kind !== "run-started") throw new Error("no run-started");
    return started.config as { builder: Record<string, unknown>; calibration?: CalibrationResolution };
  };

  test("calibrated model records per-field provenance; builder string kept", async () => {
    const cfg = await startedConfig("gemma4:e4b", "auto");
    expect(cfg.builder.calibration).toBe("auto");
    expect(cfg.calibration?.mode).toBe("auto");
    expect(cfg.calibration?.fields.steeringCompliance?.source).toBe("shipped");
    expect(cfg.calibration?.probeVersion).toBeGreaterThan(0);
  });

  test("uncalibrated model records 'unresolved' rather than nothing", async () => {
    const cfg = await startedConfig("totally-unknown:model", "auto");
    expect(cfg.calibration).toEqual({ mode: "unresolved", tiers: [], fields: {} });
  });
});
