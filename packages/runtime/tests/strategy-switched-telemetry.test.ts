/**
 * RunReport.strategySwitched means "the kernel made a real mid-run strategy
 * switch" (the run's recorded `StrategySwitched` history). A strategy body
 * error or invalid result shape (`metadata.strategyFallback`) is a failure,
 * not a switch, and must not read as one.
 */
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { TelemetryClient, type RunReport } from "@reactive-agents/reactive-intelligence";
import { emitTelemetryRunReport, type TelemetryEmitDeps } from "../src/engine/finalize/telemetry-emit";
import { deriveStrategySwitched } from "../src/telemetry-enrichment";
import { STRATEGY_SWITCHES_KEY } from "../src/engine/phases/agent-loop/strategy-switch-capture";
import { makeExecutionContext, makeRuntimeConfig, makeTask } from "../src/testing/index";

const MODEL = "switched-pin-model";
const ENV_KEYS = ["REACTIVE_AGENTS_OBSERVATIONS_DIR", "DO_NOT_TRACK", "REACTIVE_AGENTS_TELEMETRY"] as const;
let dir: string;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ra-switched-telemetry-"));
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  delete process.env.DO_NOT_TRACK;
  delete process.env.REACTIVE_AGENTS_TELEMETRY;
  process.env.REACTIVE_AGENTS_OBSERVATIONS_DIR = dir;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rmSync(dir, { recursive: true, force: true });
});

const entropyPoint: TelemetryEmitDeps["entropyLog"][number] = {
  iteration: 1,
  composite: 0.4,
  sources: { token: null, structural: 0.3, semantic: null, behavioral: 0.2, contextPressure: 0.1 },
  trajectory: { derivative: 0, shape: "flat", momentum: 0 },
  confidence: "medium",
};

async function emit(opts: { switches?: unknown; strategyFallback?: boolean; status?: string }): Promise<RunReport | undefined> {
  const sent: RunReport[] = [];
  const spy = spyOn(TelemetryClient.prototype, "send").mockImplementation((r: RunReport) => {
    sent.push(r);
  });
  try {
    await Effect.runPromise(
      emitTelemetryRunReport({
        ctx: makeExecutionContext({
          selectedModel: MODEL,
          iteration: 1,
          ...(opts.switches !== undefined ? { metadata: { [STRATEGY_SWITCHES_KEY]: opts.switches } } : {}),
        }),
        task: makeTask(),
        config: makeRuntimeConfig({
          enableReactiveIntelligence: true,
          reactiveIntelligenceOptions: { telemetry: true },
          provider: "anthropic",
          defaultModel: MODEL,
        }),
        obs: null,
        rr: {
          output: "",
          ...(opts.status !== undefined ? { status: opts.status } : {}),
          metadata: opts.strategyFallback === true ? { strategyFallback: true } : {},
        },
        terminatedByRaw: "final_answer",
        errorsFromLoop: [],
        runOutcome: "success",
        executionDurationMs: 10,
        entropyLog: [entropyPoint],
        toolCallLog: [],
        effectiveRequiredTools: undefined,
        dialectObserved: "native-fc",
      }),
    );
  } finally {
    spy.mockRestore();
  }
  return sent[0];
}

describe("RunReport.strategySwitched", () => {
  test("a real switch in the run history -> true", async () => {
    const report = await emit({ switches: [{ from: "reactive", to: "plan-execute", iteration: 3 }] });
    expect(report?.strategySwitched).toBe(true);
  });

  test("a strategy body error (strategyFallback, no switch) -> false", async () => {
    const report = await emit({ strategyFallback: true, status: "error" });
    expect(report?.strategySwitched).toBe(false);
  });

  test("no switch -> false", async () => {
    const report = await emit({});
    expect(report?.strategySwitched).toBe(false);
  });

  test("deriveStrategySwitched ignores malformed history", () => {
    expect(deriveStrategySwitched({})).toBe(false);
    expect(deriveStrategySwitched({ [STRATEGY_SWITCHES_KEY]: [{ from: 1 }] })).toBe(false);
    expect(deriveStrategySwitched({ [STRATEGY_SWITCHES_KEY]: [{ from: "a", to: "b" }] })).toBe(true);
  });
});
