// Env-var telemetry opt-out (first-touch trust, industry convention).
//
// RI telemetry is on by default (with a dismissible notice) — but a user or CI
// environment must be able to kill it WITHOUT touching code. Two standard
// switches, honored at the single upload choke point (TelemetryClient.send)
// AND consulted by the runtime's notice/emit gates via telemetryOptedOut():
//   - DO_NOT_TRACK   (console DNT convention: set and not "0" → opted out)
//   - REACTIVE_AGENTS_TELEMETRY=0|false  (project-scoped kill switch)
// Cut the guard in send() and the "send() respects" tests go red.

import { describe, it, expect, afterEach } from "bun:test";
import {
  TelemetryClient,
  telemetryOptedOut,
} from "../../src/telemetry/telemetry-client.js";
import type { RunReport } from "../../src/telemetry/types.js";

const makeReport = (): RunReport =>
  ({
    id: "r",
    installId: "i",
    modelId: "claude-sonnet-4",
    modelTier: "frontier",
    provider: "anthropic",
    taskCategory: "coding",
    toolCount: 0,
    toolsUsed: [],
    strategyUsed: "reactive",
    strategySwitched: false,
    entropyTrace: [],
    terminatedBy: "final-answer",
    outcome: "success",
    totalIterations: 1,
    totalTokens: 1,
    durationMs: 1,
    clientVersion: "0.8.0",
  }) as unknown as RunReport;

const ENV_KEYS = ["DO_NOT_TRACK", "REACTIVE_AGENTS_TELEMETRY"] as const;
const saved: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) saved[k] = process.env[k];

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const attempts = (c: TelemetryClient) => c.getSinkHealth().attempts;

describe("telemetryOptedOut()", () => {
  it("false by default (no env set)", () => {
    delete process.env.DO_NOT_TRACK;
    delete process.env.REACTIVE_AGENTS_TELEMETRY;
    expect(telemetryOptedOut()).toBe(false);
  });

  it("DO_NOT_TRACK=1 opts out; DO_NOT_TRACK=0 does not (DNT convention)", () => {
    process.env.DO_NOT_TRACK = "1";
    expect(telemetryOptedOut()).toBe(true);
    process.env.DO_NOT_TRACK = "0";
    expect(telemetryOptedOut()).toBe(false);
  });

  it("REACTIVE_AGENTS_TELEMETRY=0/false opts out; =1 does not", () => {
    delete process.env.DO_NOT_TRACK;
    process.env.REACTIVE_AGENTS_TELEMETRY = "0";
    expect(telemetryOptedOut()).toBe(true);
    process.env.REACTIVE_AGENTS_TELEMETRY = "false";
    expect(telemetryOptedOut()).toBe(true);
    process.env.REACTIVE_AGENTS_TELEMETRY = "1";
    expect(telemetryOptedOut()).toBe(false);
  });
});

describe("TelemetryClient.send() respects the opt-out (no upload attempt)", () => {
  it("DO_NOT_TRACK=1 → zero sink attempts", () => {
    process.env.DO_NOT_TRACK = "1";
    const client = new TelemetryClient("http://localhost:0");
    client.send(makeReport());
    expect(attempts(client)).toBe(0);
  });

  it("REACTIVE_AGENTS_TELEMETRY=0 → zero sink attempts", () => {
    delete process.env.DO_NOT_TRACK;
    process.env.REACTIVE_AGENTS_TELEMETRY = "0";
    const client = new TelemetryClient("http://localhost:0");
    client.send(makeReport());
    expect(attempts(client)).toBe(0);
  });

  it("CONTROL: with no opt-out a real report is attempted", () => {
    delete process.env.DO_NOT_TRACK;
    delete process.env.REACTIVE_AGENTS_TELEMETRY;
    const client = new TelemetryClient("http://localhost:0");
    client.send(makeReport());
    expect(attempts(client)).toBe(1);
  });
});
