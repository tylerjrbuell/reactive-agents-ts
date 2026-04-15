import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadObservations,
  appendObservation,
  observationsPath,
} from "../../src/calibration/observations-store.js";
import type { RunObservation } from "../../src/calibration/observations-types.js";

let testRoot: string;

beforeEach(() => {
  testRoot = mkdtempSync(join(tmpdir(), "ra-observations-"));
});

afterEach(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

const sampleRun: RunObservation = {
  at: "2026-04-15T12:00:00.000Z",
  parallelTurnCount: 1,
  totalTurnCount: 3,
  dialect: "native-fc",
  classifierRequired: ["web-search"],
  classifierActuallyCalled: ["web-search"],
  subagentInvoked: 0,
  subagentSucceeded: 0,
  argValidityRate: 1.0,
};

describe("observations-store", () => {
  it("loadObservations returns empty record for unknown model", () => {
    const obs = loadObservations("missing-model", { baseDir: testRoot });
    expect(obs.sampleCount).toBe(0);
    expect(obs.runs).toEqual([]);
  });

  it("appendObservation creates file and persists the run", () => {
    appendObservation("cogito", sampleRun, { baseDir: testRoot });
    expect(existsSync(observationsPath("cogito", testRoot))).toBe(true);

    const obs = loadObservations("cogito", { baseDir: testRoot });
    expect(obs.sampleCount).toBe(1);
    expect(obs.runs).toHaveLength(1);
    expect(obs.runs[0]!.dialect).toBe("native-fc");
  });

  it("caps stored runs at OBSERVATIONS_WINDOW (rolling window)", () => {
    for (let i = 0; i < 55; i++) {
      appendObservation("cogito", { ...sampleRun, totalTurnCount: i }, { baseDir: testRoot });
    }
    const obs = loadObservations("cogito", { baseDir: testRoot });
    expect(obs.runs.length).toBe(50);
    // Most recent observation wins — totalTurnCount values should be 5..54
    expect(obs.runs[0]!.totalTurnCount).toBe(5);
    expect(obs.runs[49]!.totalTurnCount).toBe(54);
    expect(obs.sampleCount).toBe(55); // cumulative, not bounded by window
  });

  it("normalizes modelId for filename (colons → dashes)", () => {
    appendObservation("qwen2.5-coder:14b", sampleRun, { baseDir: testRoot });
    expect(existsSync(observationsPath("qwen2.5-coder:14b", testRoot))).toBe(true);
  });

  it("gracefully handles corrupt JSON file by returning empty record", () => {
    const path = observationsPath("cogito", testRoot);
    mkdirSync(testRoot, { recursive: true });
    writeFileSync(path, "{not valid json");
    const obs = loadObservations("cogito", { baseDir: testRoot });
    expect(obs.sampleCount).toBe(0);
  });
});
