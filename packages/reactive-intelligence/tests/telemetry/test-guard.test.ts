import { describe, it, expect } from "bun:test";
import { TelemetryClient } from "../../src/telemetry/telemetry-client.js";
import type { RunReport } from "../../src/telemetry/types.js";

const makeReport = (overrides: Partial<RunReport> = {}): RunReport => ({
  id: "test-report-id",
  installId: "test-install",
  modelId: overrides.modelId ?? "claude-sonnet-4",
  modelTier: "frontier",
  provider: overrides.provider ?? "anthropic",
  taskCategory: "coding",
  toolCount: 0,
  toolsUsed: [],
  strategyUsed: "reactive",
  strategySwitched: false,
  entropyTrace: [],
  terminatedBy: "final-answer",
  outcome: "success",
  totalIterations: 2,
  totalTokens: 100,
  durationMs: 1000,
  clientVersion: "0.8.0",
  ...overrides,
});

describe("TelemetryClient test guard", () => {
  it("send() silently skips when provider is 'test'", () => {
    const client = new TelemetryClient("http://localhost:0");
    const consoleSpy = { logged: false };
    const origLog = console.log;
    console.log = (..._args: any[]) => { consoleSpy.logged = true; };
    client.send(makeReport({ provider: "test" }));
    console.log = origLog;
    expect(consoleSpy.logged).toBe(false);
  });

  it("send() silently skips when modelId is 'test'", () => {
    const client = new TelemetryClient("http://localhost:0");
    const consoleSpy = { logged: false };
    const origLog = console.log;
    console.log = (..._args: any[]) => { consoleSpy.logged = true; };
    client.send(makeReport({ modelId: "test" }));
    console.log = origLog;
    expect(consoleSpy.logged).toBe(false);
  });

  it("send() silently skips when modelId starts with 'test-'", () => {
    const client = new TelemetryClient("http://localhost:0");
    const consoleSpy = { logged: false };
    const origLog = console.log;
    console.log = (..._args: any[]) => { consoleSpy.logged = true; };
    client.send(makeReport({ modelId: "test-scenario-1" }));
    console.log = origLog;
    expect(consoleSpy.logged).toBe(false);
  });

  it("send() sets noticePrinted after first call for real providers", () => {
    const client = new TelemetryClient("http://localhost:0");
    // Notice is now emitted via ObservableLogger — no console.log.
    expect((client as unknown as { noticePrinted: boolean }).noticePrinted).toBe(false);
    client.send(makeReport({ provider: "anthropic", modelId: "claude-sonnet-4" }));
    expect((client as unknown as { noticePrinted: boolean }).noticePrinted).toBe(true);
  });
});
