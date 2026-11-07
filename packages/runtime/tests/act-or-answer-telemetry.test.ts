/**
 * Act-or-answer counts reach calibration learning.
 *
 * The kernel relays its tally on `result.metadata.extensions.actOrAnswer`.
 * `emitTelemetryRunReport` must map it into BOTH the community RunReport and
 * the local RunObservation (which `deriveActOrAnswer` reads). Absent tally:
 * the five fields are absent from both.
 */
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { TelemetryClient, loadObservations, type RunReport } from "@reactive-agents/reactive-intelligence";
import { emitTelemetryRunReport, type TelemetryEmitDeps } from "../src/engine/finalize/telemetry-emit";
import { readActOrAnswerCounts } from "../src/engine/finalize/act-or-answer-read";
import { makeExecutionContext, makeRuntimeConfig, makeTask } from "../src/testing/index";

const MODEL = "aoa-pin-model";
const FIELDS = ["noCallStallTurns", "unforcedToolWorkTurns", "forcedCalls", "forcedCallsCalled", "forcedCallsSucceeded"] as const;
const TALLY = { noCallStalls: 2, unforcedToolWorkTurns: 5, forced: 3, forcedCalled: 2, forcedCallSucceeded: 1 };
const EXPECTED = { noCallStallTurns: 2, unforcedToolWorkTurns: 5, forcedCalls: 3, forcedCallsCalled: 2, forcedCallsSucceeded: 1 };

const ENV_KEYS = ["REACTIVE_AGENTS_OBSERVATIONS_DIR", "DO_NOT_TRACK", "REACTIVE_AGENTS_TELEMETRY"] as const;
let dir: string;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ra-aoa-telemetry-"));
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

/** Run the emitter with a stubbed upload; return the report sent and the observation persisted. */
async function emit(extensions?: Record<string, unknown>) {
  const sent: RunReport[] = [];
  const spy = spyOn(TelemetryClient.prototype, "send").mockImplementation((r: RunReport) => {
    sent.push(r);
  });
  try {
    await Effect.runPromise(
      emitTelemetryRunReport({
        ctx: makeExecutionContext({ selectedModel: MODEL, iteration: 2 }),
        task: makeTask(),
        config: makeRuntimeConfig({ enableReactiveIntelligence: true, provider: "anthropic", defaultModel: MODEL }),
        obs: null,
        rr: { output: "ok", metadata: extensions === undefined ? {} : { extensions } },
        terminatedByRaw: "final_answer",
        errorsFromLoop: [],
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
  const runs = loadObservations(MODEL, { baseDir: dir }).runs;
  return { report: sent[0], observation: runs[runs.length - 1] };
}

describe("act-or-answer counts into RunReport + RunObservation", () => {
  test("a relayed tally maps into both records", async () => {
    const { report, observation } = await emit({ actOrAnswer: TALLY });
    expect(report).toBeDefined();
    expect(observation).toBeDefined();
    for (const f of FIELDS) {
      expect(report?.[f]).toBe(EXPECTED[f]);
      expect(observation?.[f]).toBe(EXPECTED[f]);
    }
  });

  test("no tally: the fields are absent from both records", async () => {
    const { report, observation } = await emit();
    expect(report).toBeDefined();
    expect(observation).toBeDefined();
    for (const f of FIELDS) {
      expect(report !== undefined && f in report).toBe(false);
      expect(observation !== undefined && f in observation).toBe(false);
    }
  });
});

describe("readActOrAnswerCounts", () => {
  test("maps the tally field names; malformed or absent yields {}", () => {
    expect(readActOrAnswerCounts({ extensions: { actOrAnswer: TALLY } })).toEqual(EXPECTED);
    expect(readActOrAnswerCounts(undefined)).toEqual({});
    expect(readActOrAnswerCounts({})).toEqual({});
    expect(readActOrAnswerCounts({ extensions: { actOrAnswer: { ...TALLY, forced: "3" } } })).toEqual({});
  });
});
