// Run: bun test packages/reasoning/tests/kernel/compute-offload.test.ts --timeout 15000
//
// Compute offload (harness switch `computeOffload`, default OFF). Spike
// wiki/Research/Harness-Reports/2026-11-15-compute-offload-spike.md: aggregate
// figures were computed in the model's head and were wrong 35% of the time,
// with `code-execute` absent from the surface in 86% of those runs. Three
// pieces, each pinned here:
//  1. the trigger: an aggregate verb AND a data-source reference;
//  2. the surface: `code-execute` stays visible (builtins-floor) when triggered;
//  3. the guidance: one advisory line once data was read without a successful
//     `code-execute` call, via the `ics-nudge` turn operation.
// Switch off: surface and state are byte-identical. Advisory only.
import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { TextParseDriver } from "@reactive-agents/tools";
import { makeStep } from "../../src/kernel/capabilities/sense/step-utils.js";
import { makeObservationResult } from "../../src/kernel/utils/observation-helpers.js";
import { makeKernelInput, makeKernelState } from "../../src/testing/kernel-fixtures.js";
import { resolveHarnessConfig } from "../../src/harness-config.js";
import { CONTEXT_PROFILES } from "../../src/context/context-profile.js";
import { resolveThinkToolSurface } from "../../src/kernel/capabilities/reason/resolve-think-surface.js";
import {
  asksForComputedAggregate,
  COMPUTE_OFFLOAD_LINE,
} from "../../src/kernel/capabilities/comprehend/compute-offload.js";
import {
  applyComputeOffloadGuidance,
  computeOffloadLine,
} from "../../src/kernel/loop/iterate-compute-offload-seam.js";
import { SEAM_TURN_OPERATIONS, openTurnScope } from "../../src/kernel/loop/turn-operations.js";
import type { IterationConfig } from "../../src/kernel/loop/iterate-pass.js";
import { noopHooks, type KernelContext, type KernelInput, type KernelState } from "../../src/kernel/state/kernel-state.js";
import type { ToolSchema } from "../../src/kernel/capabilities/attend/tool-formatting.js";
import type { ReasoningStep } from "../../src/types/index.js";

const MEAN_TASK =
  "readings.csv in your working directory has columns hour,temp. Compute the mean of the temp column rounded to 2 decimal places and write only that number to mean.txt in your working directory.";

describe("trigger: aggregate verb AND data-source reference", () => {
  it("fires on aggregation tasks from the bench", () => {
    expect(asksForComputedAggregate(MEAN_TASK)).toBe(true);
    expect(asksForComputedAggregate("a.json and b.json each have a numeric \"count\" field. Add the two counts together and reply with the sum.")).toBe(true);
    expect(asksForComputedAggregate("inventory.csv lists SKUs. Write totals.json: {\"totalUnits\": <sum of all qty>}.")).toBe(true);
    expect(asksForComputedAggregate("Read the file ./ledger.json and report the exact total of the \"amount\" fields as a number.")).toBe(true);
  });

  it("stays quiet on the false triggers the keyword rule had (rw-4, rw-9, h3-continuation)", () => {
    expect(asksForComputedAggregate("Using the JSONPlaceholder API at https://jsonplaceholder.typicode.com, fetch all posts by user ID 3, enrich each post with its comment count, and write a TypeScript module to output.ts that exports a typed EnrichedPost[] array as a const.")).toBe(false);
    expect(asksForComputedAggregate("Fetch today's cryptocurrency prices for BTC, ETH, and SOL from the price API and write a summary to prices.md with current price, 24h change, and market cap. If the API is unavailable, check whether a fallback-prices.json file exists.")).toBe(false);
    expect(asksForComputedAggregate("Read config.json in your working directory and tell me the value of build.releaseCode. Reply with that value.")).toBe(false);
  });

  it("needs both parts: a verb alone or a file alone does not fire", () => {
    expect(asksForComputedAggregate("What is the average airspeed of an unladen swallow?")).toBe(false);
    expect(asksForComputedAggregate("Copy notes.txt to backup.txt.")).toBe(false);
  });
});

// ── Surface ─────────────────────────────────────────────────────────────────

const tool = (name: string): ToolSchema => ({
  name,
  description: `${name} tool`,
  parameters: [{ name: "input", type: "string", description: "input", required: true }],
});
const FILE_READ = tool("file-read");
const CODE_EXECUTE = tool("code-execute");

function surfaceContext(task: string, harness: ReturnType<typeof resolveHarnessConfig>, extra: Partial<KernelInput> = {}): KernelContext {
  return {
    input: makeKernelInput({ task, harness, ...extra }),
    profile: CONTEXT_PROFILES["mid"],
    compression: { budget: 800, previewItems: 5, autoStore: true, codeTransform: true },
    toolService: { _tag: "None" },
    hooks: noopHooks,
    toolCallingDriver: new TextParseDriver(),
    memoryService: { _tag: "None" },
  };
}

function surface(state: KernelState, context: KernelContext) {
  return Effect.runPromise(
    resolveThinkToolSurface({ state, context }).pipe(
      Effect.map((r) => ({ names: r.toolSurface.visible.map((s) => s.name), reasons: r.toolSurface.reasons })),
    ),
  );
}

describe("surface: code-execute stays visible on an aggregation task (computeOffload on)", () => {
  // The task declared only file-read; code-execute sits in the permitted catalog.
  const extra = { availableToolSchemas: [FILE_READ], allToolSchemas: [FILE_READ, CODE_EXECUTE] };

  it("off (default): the surface is the task's own tools, code-execute is absent", async () => {
    const out = await surface(makeKernelState(), surfaceContext(MEAN_TASK, resolveHarnessConfig(), extra));
    expect(out.names).toContain("file-read");
    expect(out.names).not.toContain("code-execute");
  });

  it("on + aggregation task: code-execute joins the surface as a builtins-floor tool", async () => {
    const out = await surface(makeKernelState(), surfaceContext(MEAN_TASK, resolveHarnessConfig({ computeOffload: true }), extra));
    expect(out.names).toContain("code-execute");
    expect(out.reasons.get("code-execute")).toContain("builtins-floor");
  });

  it("on + non-aggregation task: the surface is unchanged", async () => {
    const task = "Read config.json and tell me the value of build.releaseCode.";
    const off = await surface(makeKernelState(), surfaceContext(task, resolveHarnessConfig(), extra));
    const on = await surface(makeKernelState(), surfaceContext(task, resolveHarnessConfig({ computeOffload: true }), extra));
    expect(on.names).toEqual(off.names);
  });

  it("on: never widens permission, a tool absent from the permitted catalog stays absent", async () => {
    const out = await surface(
      makeKernelState(),
      surfaceContext(MEAN_TASK, resolveHarnessConfig({ computeOffload: true }), { availableToolSchemas: [FILE_READ], allToolSchemas: [FILE_READ] }),
    );
    expect(out.names).not.toContain("code-execute");
  });

  it("on: survives the lazy prune on a large surface (floor, not keyword luck)", async () => {
    const many = Array.from({ length: 20 }, (_, i) => tool(`zz-tool-${i}`));
    const big = { availableToolSchemas: [FILE_READ, CODE_EXECUTE, ...many], allToolSchemas: [FILE_READ, CODE_EXECUTE, ...many] };
    const off = await surface(makeKernelState(), surfaceContext("Compute the mean of the temp column in readings.csv.", resolveHarnessConfig(), big));
    const on = await surface(makeKernelState(), surfaceContext("Compute the mean of the temp column in readings.csv.", resolveHarnessConfig({ computeOffload: true }), big));
    expect(on.names).toContain("code-execute");
    expect(on.reasons.get("code-execute")).toContain("builtins-floor");
    expect(off.reasons.get("code-execute")).not.toContain("builtins-floor");
  });
});

// ── Guidance ────────────────────────────────────────────────────────────────

let seq = 0;
function call(name: string, ok: boolean, args: Record<string, unknown> = {}): ReasoningStep[] {
  const id = `c${++seq}`;
  return [
    makeStep("action", `${name}(${JSON.stringify(args)})`, { toolCall: { id, name, arguments: args } }),
    makeStep("observation", ok ? "ok" : "failed", { toolCallId: id, observationResult: makeObservationResult(name, ok, ok ? "ok" : "failed") }),
  ];
}

const ON = resolveHarnessConfig({ computeOffload: true });
const inputOf = (task: string, harness = ON) =>
  makeKernelInput({ task, harness, availableToolSchemas: [FILE_READ, CODE_EXECUTE] });
const stateOf = (steps: readonly ReasoningStep[]) => makeKernelState({ iteration: 2, steps: [...steps] });

describe("guidance: one advisory line once data was read without a successful code-execute", () => {
  const READ_ONLY = call("file-read", true, { path: "readings.csv" });

  it("data read, no compute: the line is appended to guidance, once", () => {
    const state = stateOf(READ_ONLY);
    expect(computeOffloadLine(state, inputOf(MEAN_TASK))).toBe(COMPUTE_OFFLOAD_LINE);
    const next = applyComputeOffloadGuidance(state, inputOf(MEAN_TASK));
    expect(next.pendingGuidance?.icsGuidance).toBe("Compute figures with code-execute; do not estimate them mentally.");
    expect(next.meta.computeOffloadHinted).toBe(true);
    expect(applyComputeOffloadGuidance(next, inputOf(MEAN_TASK))).toBe(next);
  });

  it("appends to guidance already pending instead of replacing it", () => {
    const seeded = { ...stateOf(READ_ONLY), pendingGuidance: { icsGuidance: "earlier steer", errorRecovery: "keep me" } };
    const out = applyComputeOffloadGuidance(seeded, inputOf(MEAN_TASK)).pendingGuidance;
    expect(out?.icsGuidance).toBe(`earlier steer\n${COMPUTE_OFFLOAD_LINE}`);
    expect(out?.errorRecovery).toBe("keep me");
  });

  it("says nothing before any data was read", () => {
    expect(computeOffloadLine(stateOf([]), inputOf(MEAN_TASK))).toBeUndefined();
  });

  it("says nothing when the only successes are writes, meta tools, or failed reads", () => {
    const steps = [...call("file-write", true), ...call("final-answer", true), ...call("file-read", false)];
    expect(computeOffloadLine(stateOf(steps), inputOf(MEAN_TASK))).toBeUndefined();
  });

  it("says nothing once a code-execute call succeeded; a failed call does not count", () => {
    expect(computeOffloadLine(stateOf([...READ_ONLY, ...call("code-execute", true)]), inputOf(MEAN_TASK))).toBeUndefined();
    expect(computeOffloadLine(stateOf([...READ_ONLY, ...call("code-execute", false)]), inputOf(MEAN_TASK))).toBe(COMPUTE_OFFLOAD_LINE);
  });

  it("says nothing on a non-aggregation task", () => {
    expect(computeOffloadLine(stateOf(READ_ONLY), inputOf("Read config.json and tell me build.releaseCode."))).toBeUndefined();
  });

  it("says nothing when code-execute is not on the run's surface (never points at an uncallable tool)", () => {
    const input = makeKernelInput({ task: MEAN_TASK, harness: ON, availableToolSchemas: [FILE_READ] });
    expect(computeOffloadLine(stateOf(READ_ONLY), input)).toBeUndefined();
  });

  it("switch off: the same state comes back, nothing in guidance or meta", () => {
    const state = stateOf(READ_ONLY);
    const off = inputOf(MEAN_TASK, resolveHarnessConfig());
    expect(computeOffloadLine(state, off)).toBeUndefined();
    expect(applyComputeOffloadGuidance(state, off)).toBe(state);
  });

  it("the ics-nudge turn operation applies it (the seam is wired, not just exported)", async () => {
    const run = async (harness: typeof ON) => {
      const t = openTurnScope({
        state: { ...stateOf(READ_ONLY), status: "acting" },
        currentInput: inputOf(MEAN_TASK, harness),
        currentOptions: { maxIterations: 5, strategy: "reactive" },
        currentContext: {} as KernelContext,
        prevActionCount: 0, prevStepCount: 0, prevStepCountForLearn: 0, prevDecisionLogCountForLearn: 0,
        prevArtifactCount: 0, consecutiveStalled: 0, requiredToolRedirects: 0, requiredToolNudgeCount: 0,
        failureRecoveryRedirects: 0, switchCount: 0, triedStrategies: [], autoCheckpointed: false,
        mutableScratchpad: new Map(),
      });
      t.pass.stepsAtPassStart = 0;
      // status "acting" skips the ICS coordinator, so no profile is read.
      await Effect.runPromise(SEAM_TURN_OPERATIONS["ics-nudge"](t, {} as IterationConfig) as Effect.Effect<unknown>);
      return t.state;
    };
    expect((await run(ON)).pendingGuidance?.icsGuidance).toBe(COMPUTE_OFFLOAD_LINE);
    expect((await run(resolveHarnessConfig())).pendingGuidance).toBeUndefined();
  });
});
