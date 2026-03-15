import { describe, expect, test } from "bun:test";
import { TelemetryClient } from "../../src/telemetry/telemetry-client.js";
import type { RunReport } from "../../src/telemetry/types.js";

const mockReport: RunReport = {
  id: "test-run-id",
  installId: "test-install-id",
  modelId: "claude-sonnet-4-20250514",
  modelTier: "frontier",
  provider: "anthropic",
  taskCategory: "general",
  toolCount: 2,
  toolsUsed: ["web-search", "file-read"],
  strategyUsed: "reactive",
  strategySwitched: false,
  entropyTrace: [
    {
      iteration: 1,
      composite: 0.45,
      sources: {
        token: 0.3,
        structural: 0.5,
        semantic: 0.4,
        behavioral: 0.6,
        contextPressure: 0.2,
      },
      trajectory: {
        derivative: -0.05,
        shape: "converging",
        momentum: 0.1,
      },
      confidence: "high",
    },
  ],
  terminatedBy: "final_answer",
  outcome: "success",
  totalIterations: 3,
  totalTokens: 1500,
  durationMs: 5000,
  clientVersion: "0.8.0",
};

describe("TelemetryClient", () => {
  test("constructs without error", () => {
    const client = new TelemetryClient("http://localhost:9999");
    expect(client).toBeInstanceOf(TelemetryClient);
  });

  test("getInstallId() returns a string", () => {
    const client = new TelemetryClient("http://localhost:9999");
    const id = client.getInstallId();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  test("send() does not throw even when endpoint is unreachable", () => {
    const client = new TelemetryClient("http://localhost:1");
    expect(() => client.send(mockReport)).not.toThrow();
  });

  test("send() prints console notice on first call only", () => {
    const client = new TelemetryClient("http://localhost:9999");
    const originalLog = console.log;
    const logs: string[] = [];
    console.log = (...args: any[]) => logs.push(args.join(" "));
    try {
      client.send(mockReport);
      expect(logs.some((l) => l.includes("telemetry enabled"))).toBe(true);
      logs.length = 0;
      client.send(mockReport);
      expect(logs.some((l) => l.includes("telemetry enabled"))).toBe(false);
    } finally {
      console.log = originalLog;
    }
  });
});
