/**
 * Run telemetry is opt-in (owner decision 2026-11-17).
 *
 * An agent with Reactive Intelligence on but no telemetry setting sends no
 * RunReport and prints no telemetry notice. Telemetry turns on only with
 * `.withReactiveIntelligence({ telemetry: true | { enabled: true } })` or
 * env `REACTIVE_AGENTS_TELEMETRY=1|true`. `DO_NOT_TRACK` beats every opt-in.
 * The local run observation (disk only, feeds calibration) is written either way.
 *
 * Red-on-cut: make `isRunTelemetryEnabled` treat an unset `telemetry` as on
 * (the pre-2026-11-17 default) -> E1, N1 red.
 */
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { makeObservableLogger, ObservableLogger } from "@reactive-agents/observability";
import { TelemetryClient, loadObservations, type RunReport } from "@reactive-agents/reactive-intelligence";
import { emitTelemetryRunReport, type TelemetryEmitDeps } from "../src/engine/finalize/telemetry-emit";
import { isRunTelemetryEnabled } from "../src/engine/telemetry-gate";
import { makeExecutionContext, makeRuntimeConfig, makeTask } from "../src/testing/index";

const MODEL = "opt-in-pin-model";
const ENV_KEYS = [
  "REACTIVE_AGENTS_OBSERVATIONS_DIR",
  "DO_NOT_TRACK",
  "REACTIVE_AGENTS_TELEMETRY",
  "REACTIVE_AGENTS_SUPPRESS_NOTICES",
] as const;
let dir: string;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ra-telemetry-opt-in-"));
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  delete process.env.DO_NOT_TRACK;
  delete process.env.REACTIVE_AGENTS_TELEMETRY;
  delete process.env.REACTIVE_AGENTS_SUPPRESS_NOTICES;
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

/** Run the emitter with a stubbed upload; return the reports sent. */
async function emit(riOptions?: Record<string, unknown>): Promise<RunReport[]> {
  const sent: RunReport[] = [];
  const spy = spyOn(TelemetryClient.prototype, "send").mockImplementation((r: RunReport) => {
    sent.push(r);
  });
  try {
    await Effect.runPromise(
      emitTelemetryRunReport({
        ctx: makeExecutionContext({ selectedModel: MODEL, iteration: 2 }),
        task: makeTask(),
        config: makeRuntimeConfig({
          enableReactiveIntelligence: true,
          provider: "anthropic",
          defaultModel: MODEL,
          ...(riOptions !== undefined ? { reactiveIntelligenceOptions: riOptions } : {}),
        }),
        obs: null,
        rr: { output: "ok", metadata: {} },
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
  return sent;
}

describe("RunReport upload is opt-in", () => {
  test("E1 no telemetry setting, no env: nothing is sent", async () => {
    expect(await emit()).toEqual([]);
    expect(await emit({ controller: { earlyStop: true } })).toEqual([]);
  });

  test("E1b the local run observation is still written when telemetry is off", async () => {
    await emit();
    expect(loadObservations(MODEL, { baseDir: dir }).runs.length).toBe(1);
  });

  test("E2 explicit telemetry: true or { enabled: true } sends", async () => {
    expect(await emit({ telemetry: true })).toHaveLength(1);
    expect(await emit({ telemetry: { enabled: true } })).toHaveLength(1);
  });

  test("E3 env REACTIVE_AGENTS_TELEMETRY=1|true opts in", async () => {
    process.env.REACTIVE_AGENTS_TELEMETRY = "1";
    expect(await emit()).toHaveLength(1);
    process.env.REACTIVE_AGENTS_TELEMETRY = "TRUE";
    expect(await emit()).toHaveLength(1);
  });

  test("E4 DO_NOT_TRACK beats an explicit opt-in", async () => {
    process.env.DO_NOT_TRACK = "1";
    expect(await emit({ telemetry: true })).toEqual([]);
    process.env.REACTIVE_AGENTS_TELEMETRY = "1";
    expect(await emit({ telemetry: { enabled: true } })).toEqual([]);
  });

  test("E5 explicit telemetry: false beats the env opt-in", async () => {
    process.env.REACTIVE_AGENTS_TELEMETRY = "1";
    expect(await emit({ telemetry: false })).toEqual([]);
    expect(await emit({ telemetry: { enabled: false } })).toEqual([]);
  });
});

describe("isRunTelemetryEnabled", () => {
  test("G1 default off; explicit/env opt-in on; env opt-out wins", () => {
    expect(isRunTelemetryEnabled(undefined)).toBe(false);
    expect(isRunTelemetryEnabled({})).toBe(false);
    expect(isRunTelemetryEnabled({ telemetry: true })).toBe(true);
    process.env.REACTIVE_AGENTS_TELEMETRY = "0";
    expect(isRunTelemetryEnabled({ telemetry: true })).toBe(false);
  });
});

/**
 * The notice manager is process-wide; import a fresh module instance per test
 * so an earlier test (or file) that showed the notice cannot mask the result.
 */
let freshImport = 0;
async function noticesEmitted(riOptions?: Record<string, unknown>): Promise<number> {
  freshImport += 1;
  const mod = (await import(
    `../src/engine/execute-telemetry-notice.ts?fresh=${freshImport}`
  )) as typeof import("../src/engine/execute-telemetry-notice");
  const config = makeRuntimeConfig({
    enableReactiveIntelligence: true,
    provider: "anthropic",
    defaultModel: MODEL,
    ...(riOptions !== undefined ? { reactiveIntelligenceOptions: riOptions } : {}),
  });
  return Effect.gen(function* () {
    const logger = yield* makeObservableLogger({ live: false });
    // Two runs in one process: a default (off) run must not use up the
    // once-per-process notice an opted-in run needs.
    yield* mod.maybeEmitRiTelemetryNotice(makeRuntimeConfig({ enableReactiveIntelligence: true })).pipe(
      Effect.provideService(ObservableLogger, logger),
    );
    yield* mod.maybeEmitRiTelemetryNotice(config).pipe(Effect.provideService(ObservableLogger, logger));
    const buffer = yield* logger.getBuffer();
    return buffer.filter((e) => e._tag === "notice").length;
  }).pipe(Effect.runPromise);
}

describe("telemetry notice", () => {
  test("N1 no telemetry setting: no notice", async () => {
    expect(await noticesEmitted()).toBe(0);
  });

  test("N2 opted in: one notice, even after a default-off run in the same process", async () => {
    expect(await noticesEmitted({ telemetry: true })).toBe(1);
  });

  test("N3 DO_NOT_TRACK: no notice even when opted in", async () => {
    process.env.DO_NOT_TRACK = "1";
    expect(await noticesEmitted({ telemetry: true })).toBe(0);
  });
});
