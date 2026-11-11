import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendObservation, BanditStore, CalibrationStore, type RunObservation } from "@reactive-agents/reactive-intelligence";
import { openDatabase } from "../db/schema.js";
import { makeModelCalibrationReader, summarizeObservations } from "../services/model-calibration.js";
import { modelInsightsRouter } from "../api/model-insights.js";

// qwen3:4b ships a prior (llm-provider calibrations/qwen3-4b.json): parallelCallCapability "reliable".
const PRIOR_MODEL = "qwen3:4b";
const NO_PRIOR_MODEL = "cortex-test-unknown-model:1b";

let dir: string;
const obs = (over: Partial<RunObservation> = {}): RunObservation => ({
  at: new Date(2026, 10, 1).toISOString(),
  parallelTurnCount: 0,
  totalTurnCount: 3,
  dialect: "native-fc",
  classifierRequired: [],
  classifierActuallyCalled: [],
  subagentInvoked: 0,
  subagentSucceeded: 0,
  argValidityRate: 1,
  ...over,
});

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "cortex-model-cal-"));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("model calibration (framework readers)", () => {
  it("shows the shipped prior's settings as shipped when there are too few observations", () => {
    const observationsDir = join(dir, "obs-few");
    appendObservation(PRIOR_MODEL, obs({ parallelTurnCount: 0 }), { baseDir: observationsDir });
    const view = makeModelCalibrationReader({ observationsDir, calibrationDbPath: join(dir, "none.db") }).read(PRIOR_MODEL);
    expect(view.status).toBe("prior");
    expect(view.prior?.runsAveraged).toBe(10);
    const parallel = view.settings.find((s) => s.key === "parallelCallCapability");
    expect(parallel).toEqual({ key: "parallelCallCapability", value: "reliable", source: "shipped" });
    expect(view.settings.find((s) => s.key === "optimalToolResultChars")?.value).toBe(2000);
    expect(view.observations.runs).toBe(1);
    expect(view.observations.threshold).toBe(5);
  });

  it("marks a value learned once local observations override the prior, keeping the prior value", () => {
    const observationsDir = join(dir, "obs-many");
    for (let i = 0; i < 6; i++) appendObservation(PRIOR_MODEL, obs({ parallelTurnCount: 0 }), { baseDir: observationsDir });
    const view = makeModelCalibrationReader({ observationsDir, calibrationDbPath: join(dir, "none.db") }).read(PRIOR_MODEL);
    const parallel = view.settings.find((s) => s.key === "parallelCallCapability");
    expect(parallel).toEqual({
      key: "parallelCallCapability",
      value: "sequential-only",
      source: "learned",
      priorValue: "reliable",
    });
    expect(view.observations.sampleCount).toBe(6);
    expect(view.observations.parallelRuns).toBe(0);
  });

  it("reports no calibration for a model without a prior, even with observations", () => {
    const observationsDir = join(dir, "obs-none");
    for (let i = 0; i < 6; i++) appendObservation(NO_PRIOR_MODEL, obs(), { baseDir: observationsDir });
    const view = makeModelCalibrationReader({ observationsDir, calibrationDbPath: join(dir, "none.db") }).read(NO_PRIOR_MODEL);
    expect(view.status).toBe("none");
    expect(view.settings).toEqual([]);
    expect(view.observations.runs).toBe(6);
    expect(view.bandit).toBeNull();
  });

  it("reads the entropy thresholds from the calibration store, and never creates the store", () => {
    const missing = join(dir, "missing.db");
    const reader = makeModelCalibrationReader({ observationsDir: join(dir, "obs-e"), calibrationDbPath: missing });
    expect(reader.read(PRIOR_MODEL).entropy).toBeNull();
    expect(existsSync(missing)).toBe(false);

    const dbPath = join(dir, "calibration.db");
    new CalibrationStore(dbPath).save({
      modelId: PRIOR_MODEL,
      calibrationScores: [0.2, 0.4],
      sampleCount: 24,
      highEntropyThreshold: 0.71,
      convergenceThreshold: 0.18,
      calibrated: true,
      lastUpdated: 1_700_000_000_000,
      driftDetected: false,
    });
    const entropy = makeModelCalibrationReader({ observationsDir: join(dir, "obs-e"), calibrationDbPath: dbPath }).read(PRIOR_MODEL).entropy;
    expect(entropy).toEqual({
      sampleCount: 24,
      calibrated: true,
      highEntropyThreshold: 0.71,
      convergenceThreshold: 0.18,
      driftDetected: false,
      lastUpdated: 1_700_000_000_000,
    });
  });

  it("reads strategy-choice (bandit) arm stats for this model from the calibration DB, grouped by task category", () => {
    const missing = join(dir, "bandit-missing.db");
    expect(makeModelCalibrationReader({ observationsDir: join(dir, "obs-b"), calibrationDbPath: missing }).read(PRIOR_MODEL).bandit).toBeNull();
    expect(existsSync(missing)).toBe(false);

    const dbPath = join(dir, "bandit.db");
    const store = new BanditStore(dbPath);
    store.save({ contextBucket: `${PRIOR_MODEL}:research`, armId: "reactive", alpha: 4, beta: 2, pulls: 4 });
    store.save({ contextBucket: `${PRIOR_MODEL}:research`, armId: "plan-execute-reflect", alpha: 2, beta: 3, pulls: 3 });
    store.save({ contextBucket: `${PRIOR_MODEL}:coding`, armId: "reflexion", alpha: 2, beta: 1, pulls: 1 });
    store.save({ contextBucket: "other-model:research", armId: "reactive", alpha: 9, beta: 1, pulls: 8 });
    store.close();

    const bandit = makeModelCalibrationReader({ observationsDir: join(dir, "obs-b"), calibrationDbPath: dbPath }).read(PRIOR_MODEL).bandit;
    expect(bandit).not.toBeNull();
    expect(bandit!.categories.map((c) => c.taskCategory)).toEqual(["coding", "research"]);
    const research = bandit!.categories[1]!;
    expect(research.arms.map((a) => [a.strategy, a.trials])).toEqual([["reactive", 4], ["plan-execute-reflect", 3]]);
    expect(research.arms[0]!.meanReward).toBeCloseTo(4 / 6, 6);
    expect(research.arms[0]!.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    expect(research.lastUpdated).toBe(research.arms[0]!.updatedAt);
    expect(makeModelCalibrationReader({ observationsDir: join(dir, "obs-b"), calibrationDbPath: dbPath }).read(NO_PRIOR_MODEL).bandit).toBeNull();
  });

  it("sums act-or-answer counts only over runs that recorded them", () => {
    const s = summarizeObservations(
      [
        obs({ parallelTurnCount: 2, classifierRequired: ["web-search"], classifierActuallyCalled: [] }),
        obs({ forcedCalls: 4, forcedCallsSucceeded: 3, noCallStallTurns: 1, unforcedToolWorkTurns: 9 }),
      ],
      2,
    );
    expect(s).toMatchObject({
      parallelRuns: 1,
      classifierMissRuns: 1,
      actOrAnswerRuns: 1,
      forcedCalls: 4,
      forcedCallsSucceeded: 3,
      noCallStallTurns: 1,
      unforcedToolWorkTurns: 9,
    });
  });

  it("GET /api/model-calibration answers 400 without a model and the view with one", async () => {
    const db = openDatabase(":memory:");
    const app = modelInsightsRouter(
      db,
      makeModelCalibrationReader({ observationsDir: join(dir, "obs-route"), calibrationDbPath: join(dir, "none.db") }),
    );
    const bad = await app.handle(new Request("http://localhost/api/model-calibration"));
    expect(bad.status).toBe(400);
    const ok = await app.handle(new Request(`http://localhost/api/model-calibration?model=${encodeURIComponent(PRIOR_MODEL)}`));
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { status: string; model: string };
    expect(body).toMatchObject({ status: "prior", model: PRIOR_MODEL });
    db.close();
  });
});
