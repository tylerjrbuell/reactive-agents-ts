import { afterEach, describe, expect, test } from "bun:test";
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

  test("send() deduplicates notice — noticePrinted set after first call", () => {
    const client = new TelemetryClient("http://localhost:9999");
    // Notice is now emitted via ObservableLogger, not console.log.
    // Verify the internal dedup flag prevents repeated notice emission.
    expect((client as unknown as { noticePrinted: boolean }).noticePrinted).toBe(false);
    client.send(mockReport);
    expect((client as unknown as { noticePrinted: boolean }).noticePrinted).toBe(true);
  });
});

describe("TelemetryClient sink health (HS-B-03 / #152)", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("test runs are not counted as sink attempts", () => {
    const client = new TelemetryClient("http://localhost:9999");
    client.send({ ...mockReport, provider: "test" });
    expect(client.getSinkHealth()).toEqual({ attempts: 0, failures: 0 });
  });

  test("a successful send increments attempts but not failures", async () => {
    globalThis.fetch = (() => Promise.resolve(new Response("ok"))) as unknown as typeof fetch;
    const client = new TelemetryClient("http://localhost:9999");
    client.send(mockReport);
    await Promise.resolve();
    expect(client.getSinkHealth()).toEqual({ attempts: 1, failures: 0 });
  });

  test("a failed fetch is counted as a sink failure (no longer silent)", async () => {
    globalThis.fetch = (() => Promise.reject(new Error("network down"))) as unknown as typeof fetch;
    const client = new TelemetryClient("http://localhost:9999");
    client.send(mockReport);
    // let the rejected fetch's .catch microtask settle
    await new Promise((r) => setTimeout(r, 0));
    expect(client.getSinkHealth()).toEqual({ attempts: 1, failures: 1 });
  });
});
