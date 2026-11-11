/**
 * The reactive-intelligence wire boundary maps an abstention to "failure".
 *
 * The remote telemetry server (api.reactiveagents.dev) can't accept
 * "abstained" yet (owner, 2026-11-10), so `toRiWireOutcome` keeps the
 * mapping and the record's `terminatedBy: "abstained"` tells the two apart.
 *
 * RED-ON-CUT:
 *  - make `toRiWireOutcome` pass "abstained" through -> both cells red.
 *  - drop `terminatedBy: terminatedByRaw` from the telemetry send -> cell 2 red.
 */
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { TelemetryClient, type RunReport } from "@reactive-agents/reactive-intelligence";
import { emitTelemetryRunReport } from "../src/engine/finalize/telemetry-emit";
import { toRiWireOutcome } from "../src/engine/util";
import { makeExecutionContext, makeRuntimeConfig, makeTask } from "../src/testing/index";

const MODEL = "ri-wire-outcome-model";
const ENV_KEYS = ["REACTIVE_AGENTS_OBSERVATIONS_DIR", "DO_NOT_TRACK", "REACTIVE_AGENTS_TELEMETRY"] as const;
let dir: string;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ra-ri-wire-outcome-"));
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

describe("toRiWireOutcome", () => {
  test("abstained crosses as failure; the wire labels pass through unchanged", () => {
    expect(toRiWireOutcome("abstained")).toBe("failure");
    expect(toRiWireOutcome("success")).toBe("success");
    expect(toRiWireOutcome("partial")).toBe("partial");
    expect(toRiWireOutcome("failure")).toBe("failure");
  });
});

describe("telemetry RunReport for an abstained run", () => {
  test("sends outcome 'failure' and terminatedBy 'abstained'", async () => {
    const sent: RunReport[] = [];
    const spy = spyOn(TelemetryClient.prototype, "send").mockImplementation((r: RunReport) => {
      sent.push(r);
    });
    try {
      await Effect.runPromise(
        emitTelemetryRunReport({
          ctx: makeExecutionContext({ selectedModel: MODEL, iteration: 1 }),
          task: makeTask(),
          config: makeRuntimeConfig({ enableReactiveIntelligence: true, provider: "anthropic", defaultModel: MODEL }),
          obs: null,
          rr: { output: "", status: "abstained", metadata: {} },
          terminatedByRaw: "abstained",
          errorsFromLoop: [],
          executionDurationMs: 10,
          entropyLog: [
            {
              iteration: 1,
              composite: 0.4,
              sources: { token: null, structural: 0.3, semantic: null, behavioral: 0.2, contextPressure: 0.1 },
              trajectory: { derivative: 0, shape: "flat", momentum: 0 },
              confidence: "medium",
            },
          ],
          toolCallLog: [],
          effectiveRequiredTools: undefined,
          dialectObserved: "native-fc",
        }),
      );
    } finally {
      spy.mockRestore();
    }
    expect(sent.length).toBe(1);
    expect(sent[0]?.outcome).toBe("failure");
    expect(sent[0]?.terminatedBy).toBe("abstained");
  });
});
