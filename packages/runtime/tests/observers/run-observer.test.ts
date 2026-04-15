import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRunObservation, persistRunObservation } from "../../src/observers/run-observer.js";
import { loadObservations } from "@reactive-agents/reactive-intelligence";

let testRoot: string;

beforeEach(() => { testRoot = mkdtempSync(join(tmpdir(), "ra-observer-")); });
afterEach(() => { rmSync(testRoot, { recursive: true, force: true }); });

describe("buildRunObservation", () => {
  it("counts parallel turns from tool-call log", () => {
    const log = [
      { turn: 0, toolName: "web-search" },
      { turn: 0, toolName: "http-get" },  // same turn → parallel
      { turn: 1, toolName: "file-write" }, // solo turn
      { turn: 2, toolName: "web-search" },
      { turn: 2, toolName: "web-search" }, // same turn → parallel
    ];
    const obs = buildRunObservation({
      modelId: "cogito",
      toolCallLog: log,
      totalTurns: 3,
      dialect: "native-fc",
      classifierRequired: ["web-search"],
      classifierActuallyCalled: ["web-search", "http-get", "file-write"],
      subagentInvoked: 0,
      subagentSucceeded: 0,
      argValidityRate: 1.0,
    });
    expect(obs.parallelTurnCount).toBe(2); // turns 0 and 2
    expect(obs.totalTurnCount).toBe(3);
  });

  it("defaults missing fields to safe values", () => {
    const obs = buildRunObservation({
      modelId: "cogito",
      toolCallLog: [],
      totalTurns: 0,
      dialect: "none",
      classifierRequired: [],
      classifierActuallyCalled: [],
      subagentInvoked: 0,
      subagentSucceeded: 0,
      argValidityRate: 1.0,
    });
    expect(obs.parallelTurnCount).toBe(0);
    expect(obs.totalTurnCount).toBe(0);
  });
});

describe("persistRunObservation", () => {
  it("appends to the model's observations file", () => {
    persistRunObservation(
      "cogito",
      buildRunObservation({
        modelId: "cogito",
        toolCallLog: [{ turn: 0, toolName: "web-search" }],
        totalTurns: 1,
        dialect: "native-fc",
        classifierRequired: [],
        classifierActuallyCalled: ["web-search"],
        subagentInvoked: 0,
        subagentSucceeded: 0,
        argValidityRate: 1.0,
      }),
      { baseDir: testRoot },
    );
    const obs = loadObservations("cogito", { baseDir: testRoot });
    expect(obs.sampleCount).toBe(1);
    expect(obs.runs[0]!.dialect).toBe("native-fc");
  });

  it("never throws even when disk is unwritable", () => {
    expect(() =>
      persistRunObservation(
        "cogito",
        buildRunObservation({
          modelId: "cogito",
          toolCallLog: [],
          totalTurns: 0,
          dialect: "none",
          classifierRequired: [],
          classifierActuallyCalled: [],
          subagentInvoked: 0,
          subagentSucceeded: 0,
          argValidityRate: 1.0,
        }),
        { baseDir: "/nonexistent/readonly/path/\0invalid" },
      ),
    ).not.toThrow();
  });
});
