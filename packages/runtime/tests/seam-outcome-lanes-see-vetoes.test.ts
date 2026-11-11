// Run: bun test packages/runtime/tests/seam-outcome-lanes-see-vetoes.test.ts --timeout 20000
//
// The telemetry and local-learning lanes classify a run the way its result and
// debrief do: a run the runtime vetoed is never a success, and a paused run is
// not recorded at all until it ends.
//
// Defect (2026-11-11, follow-up to 835c4d1cd): the debrief learned to read the
// engine's success bit and failure cause, but telemetry-emit.ts and
// local-learning.ts still called `deriveRunOutcome` on (terminatedBy, errors,
// kernel status) only. A run the kernel finished `completed` and the runtime
// vetoed (no call to a required tool succeeded) was sent to telemetry as
// `outcome: "success"` and CREDITED its applied skill. A paused run got a
// debrief and a telemetry record as if it had ended.
//
// Pins (engine/finalize: prepareDebrief computes `runOutcome` once; both lanes
// read it):
//   V1 — vetoed run: `runOutcome` is "failure", same verdict as the debrief.
//   V2 — vetoed run: the telemetry RunReport says "failure".
//   V3 — vetoed run: the learning engine gets "failure"; the applied skill is
//        recorded as a failure (never credited).
//   P1 — paused run: no `runOutcome`, no debrief.
//   P2 — paused run: no telemetry record, no learning call, no skill outcome.
//
// Red-on-cut:
//   - drop the veto fold (`foldRuntimeVeto`) in util.ts -> V1, V2, V3 red.
//   - read `deriveRunOutcome` in telemetry-emit.ts again -> V2 red.
//   - read `deriveRunOutcome` in local-learning.ts again -> V3 red.
//   - drop `!paused` from prepareDebrief -> P1 red.
//   - drop the `runOutcome === undefined` skip in either lane -> P2 red.
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer } from "effect";
import type { Task } from "@reactive-agents/core";
import { ProceduralMemoryService } from "@reactive-agents/memory";
import {
  LearningEngineService,
  TelemetryClient,
  type RunReport,
} from "@reactive-agents/reactive-intelligence";
import { prepareDebrief, type DebriefSynthesisDeps } from "../src/engine/finalize/debrief-synthesis.js";
import { emitTelemetryRunReport, type TelemetryEmitDeps } from "../src/engine/finalize/telemetry-emit.js";
import { runLocalLearning } from "../src/engine/finalize/local-learning.js";
import type { RunOutcomeClass } from "../src/engine/util.js";
import type { ExecutionContext } from "../src/types.js";
import { makeExecutionContext, makeRuntimeConfig, makeTask } from "../src/testing/index.js";

const MODEL = "outcome-lanes-model";
const ENV_KEYS = ["REACTIVE_AGENTS_OBSERVATIONS_DIR", "DO_NOT_TRACK", "REACTIVE_AGENTS_TELEMETRY"] as const;
let dir: string;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ra-outcome-lanes-"));
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

const task: Task = makeTask({ id: "t1", type: "research", input: "Search the web and summarize." });
const config = makeRuntimeConfig({
  enableReactiveIntelligence: true,
  enableMemory: true,
  provider: "anthropic",
  defaultModel: MODEL,
});

const ctx = (metadata: Partial<ExecutionContext["metadata"]>): ExecutionContext =>
  makeExecutionContext({
    taskId: "t1",
    agentId: "a1",
    selectedModel: MODEL,
    selectedStrategy: "reactive",
    iteration: 2,
    metadata,
  });

const entropyLog: TelemetryEmitDeps["entropyLog"] = [
  {
    iteration: 1,
    composite: 0.4,
    sources: { token: null, structural: 0.3, semantic: null, behavioral: 0.2, contextPressure: 0.1 },
    trajectory: { derivative: 0, shape: "flat", momentum: 0 },
    confidence: "medium",
  },
];

/** A run the kernel finished `completed` and the runtime vetoed: no call to a required tool succeeded. */
const vetoed = {
  ctx: ctx({ requiredToolUnmetNotSuccess: true, appliedSkillId: "skill-1" }),
  rr: { status: "completed", output: "Here is a summary.", metadata: { terminatedBy: "final_answer" } },
  terminatedByRaw: "final_answer",
  executionSucceeded: false,
} satisfies Partial<DebriefSynthesisDeps>;

/** A run paused at an approval gate. */
const paused = {
  ctx: ctx({ appliedSkillId: "skill-1" }),
  rr: {
    status: "partial",
    output: "",
    metadata: { terminatedBy: "end_turn", awaitingApprovalFor: { gateId: "g", toolName: "file-write", args: {} } },
  } as DebriefSynthesisDeps["rr"],
  terminatedByRaw: "end_turn",
  executionSucceeded: false,
} satisfies Partial<DebriefSynthesisDeps>;

const prepare = (run: typeof vetoed | typeof paused) =>
  Effect.runPromise(
    prepareDebrief({
      ...run,
      task,
      config,
      eb: null,
      sanitizedOutput: run.rr?.output ?? "",
      outputForSuccess: String(run.rr?.output ?? ""),
      hasSubstantiveOutput: false,
      toolCallLog: [],
    }),
  );

/** Emit telemetry with a stubbed upload; return every report sent. */
async function telemetry(run: typeof vetoed | typeof paused, runOutcome: RunOutcomeClass | undefined) {
  const sent: RunReport[] = [];
  const spy = spyOn(TelemetryClient.prototype, "send").mockImplementation((r: RunReport) => {
    sent.push(r);
  });
  try {
    await Effect.runPromise(
      emitTelemetryRunReport({
        ctx: run.ctx,
        task,
        config,
        obs: null,
        rr: run.rr,
        terminatedByRaw: run.terminatedByRaw,
        errorsFromLoop: [],
        runOutcome,
        executionDurationMs: 10,
        entropyLog,
        toolCallLog: [],
        effectiveRequiredTools: ["web-search"],
        dialectObserved: "native-fc",
      }),
    );
  } finally {
    spy.mockRestore();
  }
  return sent;
}

/** Run local learning with stub services; return what the learning engine and skill store saw. */
async function learning(run: typeof vetoed | typeof paused, runOutcome: RunOutcomeClass | undefined) {
  const learned: string[] = [];
  const skillOutcomes: boolean[] = [];
  const layer = Layer.mergeAll(
    Layer.succeed(LearningEngineService, {
      onRunCompleted: (data) => {
        learned.push(data.outcome);
        return Effect.succeed({ calibrationUpdated: false, banditUpdated: false, skillSynthesized: false, taskCategory: "research" });
      },
    }),
    Layer.succeed(ProceduralMemoryService, {
      store: () => Effect.die("unexpected store"),
      get: () => Effect.die("unexpected get"),
      recordOutcome: (_id, success) => Effect.sync(() => void skillOutcomes.push(success)),
      listActive: () => Effect.succeed([]),
      findByTags: () => Effect.succeed([]),
      delete: () => Effect.void,
    }),
  );
  await Effect.runPromise(
    runLocalLearning({
      ctx: run.ctx,
      task,
      config,
      runOutcome,
      entropyLog,
      executionDurationMs: 10,
    }).pipe(Effect.provide(layer)),
  );
  return { learned, skillOutcomes };
}

describe("a vetoed run is not a success in telemetry or learning", () => {
  test("V1 runOutcome is 'failure', the same verdict as the debrief", async () => {
    const prepared = await prepare(vetoed);
    expect(prepared.runOutcome).toBe("failure");
    expect(prepared.fallbackDebrief?.outcome).toBe("failed");
  });

  test("V2 the telemetry RunReport says 'failure'", async () => {
    const { runOutcome } = await prepare(vetoed);
    const sent = await telemetry(vetoed, runOutcome);
    expect(sent.length).toBe(1);
    expect(sent[0]?.outcome).toBe("failure");
  });

  test("V3 the learning engine gets 'failure'; the applied skill is not credited", async () => {
    const { runOutcome } = await prepare(vetoed);
    const { learned, skillOutcomes } = await learning(vetoed, runOutcome);
    expect(learned).toEqual(["failure"]);
    expect(skillOutcomes).toEqual([false]);
  });
});

describe("a paused run is not recorded until it ends", () => {
  test("P1 no runOutcome and no debrief", async () => {
    const prepared = await prepare(paused);
    expect(prepared.runOutcome).toBeUndefined();
    expect(prepared.fallbackDebrief).toBeUndefined();
    expect(prepared.shouldFinalize).toBe(false);
  });

  test("P2 no telemetry record, no learning call, no skill outcome", async () => {
    const { runOutcome } = await prepare(paused);
    expect(await telemetry(paused, runOutcome)).toEqual([]);
    const { learned, skillOutcomes } = await learning(paused, runOutcome);
    expect(learned).toEqual([]);
    expect(skillOutcomes).toEqual([]);
  });
});
