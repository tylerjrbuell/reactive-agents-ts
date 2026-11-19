// Run: bun test packages/reasoning/tests/kernel/seam-parallel-tool-hint.test.ts --timeout 20000
//
// Seam pin for kernel/capabilities/reason/parallel-tool-hint.ts (harness switch
// `parallelToolHint`, default ON and calibration-gated since 2026-11-19). Golden-run diagnosis 2026-11-18: independent
// tool calls went out one per turn although calibration rates the model
// parallel-`reliable` and the kernel already runs every call of a reply before
// the next think. With the switch on, the system prompt invites batching; a
// model that follows it does two independent calls in ONE tool turn.
//
// Zero tokens: a scripted model batches when (and only when) the hint is in
// its system prompt.
//
// RED-ON-CUT: drop the `parts.push(parallelHint)` line in think.ts: the
// end-to-end "on" case goes red (two tool turns). Drop the calibration check
// in `shouldShowParallelToolHint`: the `sequential-only` case goes red.

import { afterEach, describe, expect, it } from "bun:test";
import { Effect, Layer } from "effect";
import { LLMService, TestLLMService, type CompletionRequest, type TestTurn } from "@reactive-agents/llm-provider";
import { EventBus, EventBusLive } from "@reactive-agents/core";
import {
  PARALLEL_TOOL_HINT,
  PARALLEL_TOOL_HINT_ORIGIN,
  shouldShowParallelToolHint,
  type ParallelToolHintFacts,
} from "../../src/kernel/capabilities/reason/parallel-tool-hint.js";
import { resolveHarnessConfig, type HarnessConfig } from "../../src/harness-config.js";
import { executeReactive } from "../../src/strategies/reactive.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { mockToolServiceLayer } from "../../src/testing/tool-service-mock.js";
import { buildRunEnvelope, provideTestEnvelope } from "../../src/kernel/envelope/run-envelope.js";

const TASK = "Look up the weather in Paris and in Tokyo, then tell me which city is warmer.";
const ANSWER = "Tokyo is warmer: 24°C against 18°C in Paris.";
const PARAMS = [{ name: "city", type: "string", required: true }];
const WEATHER = { name: "weather", description: "Current weather for a city.", parameters: PARAMS };

const BASE: ParallelToolHintFacts = {
  mode: true,
  parallelCallCapability: "reliable",
  alreadyInPrompt: false,
  nativeFC: true,
  toolsWithheld: false,
  domainToolsOnSurface: true,
  planPosture: false,
  parallelCallsDisabled: false,
};

describe("parallel tool hint: when the line shows (pure)", () => {
  it("shows for a reliable model with the switch on", () => {
    expect(shouldShowParallelToolHint(BASE)).toBe(true);
  });

  it("switch off: never", () => {
    expect(shouldShowParallelToolHint({ ...BASE, mode: undefined })).toBe(false);
  });

  it("true is calibration-gated: partial, sequential-only and uncalibrated models get no line", () => {
    for (const cap of ["partial", "sequential-only", undefined]) {
      expect(shouldShowParallelToolHint({ ...BASE, parallelCallCapability: cap })).toBe(false);
    }
  });

  it('"always" shows whatever the calibration says', () => {
    expect(shouldShowParallelToolHint({ ...BASE, mode: "always", parallelCallCapability: "sequential-only" })).toBe(true);
    expect(shouldShowParallelToolHint({ ...BASE, mode: "always", parallelCallCapability: undefined })).toBe(true);
  });

  it("never twice: no line when the base prompt already carries the sentence (default mid+ prompt)", () => {
    expect(shouldShowParallelToolHint({ ...BASE, alreadyInPrompt: true })).toBe(false);
    expect(shouldShowParallelToolHint({ ...BASE, mode: "always", alreadyInPrompt: true })).toBe(false);
  });

  it("no line on text-parse, a tools-withheld turn, no domain tool, plan posture, or parallel calls off", () => {
    expect(shouldShowParallelToolHint({ ...BASE, nativeFC: false })).toBe(false);
    expect(shouldShowParallelToolHint({ ...BASE, toolsWithheld: true })).toBe(false);
    expect(shouldShowParallelToolHint({ ...BASE, domainToolsOnSurface: false })).toBe(false);
    expect(shouldShowParallelToolHint({ ...BASE, planPosture: true })).toBe(false);
    expect(shouldShowParallelToolHint({ ...BASE, parallelCallsDisabled: true })).toBe(false);
  });
});

describe("parallel tool hint: resolution (default ON, calibration-gated)", () => {
  const saved = process.env.RA_PARALLEL_TOOL_HINT;
  afterEach(() => {
    if (saved === undefined) delete process.env.RA_PARALLEL_TOOL_HINT;
    else process.env.RA_PARALLEL_TOOL_HINT = saved;
  });

  it("on (calibration-gated) by default: no config, no env resolves to true", () => {
    delete process.env.RA_PARALLEL_TOOL_HINT;
    expect(resolveHarnessConfig().parallelToolHint).toBe(true);
    expect(resolveHarnessConfig({}).parallelToolHint).toBe(true);
  });

  it("opt-out: config false, or RA_PARALLEL_TOOL_HINT=0 / off, resolves to no hint", () => {
    delete process.env.RA_PARALLEL_TOOL_HINT;
    expect("parallelToolHint" in resolveHarnessConfig({ parallelToolHint: false })).toBe(false);
    process.env.RA_PARALLEL_TOOL_HINT = "0";
    expect("parallelToolHint" in resolveHarnessConfig()).toBe(false);
    process.env.RA_PARALLEL_TOOL_HINT = "off";
    expect("parallelToolHint" in resolveHarnessConfig()).toBe(false);
    // An explicit config wins over the env kill switch.
    expect(resolveHarnessConfig({ parallelToolHint: true }).parallelToolHint).toBe(true);
  });

  it("true / always from config or env; config false beats env", () => {
    delete process.env.RA_PARALLEL_TOOL_HINT;
    expect(resolveHarnessConfig({ parallelToolHint: true }).parallelToolHint).toBe(true);
    expect(resolveHarnessConfig({ parallelToolHint: "always" }).parallelToolHint).toBe("always");
    process.env.RA_PARALLEL_TOOL_HINT = "1";
    expect(resolveHarnessConfig().parallelToolHint).toBe(true);
    process.env.RA_PARALLEL_TOOL_HINT = "always";
    expect(resolveHarnessConfig().parallelToolHint).toBe("always");
    expect("parallelToolHint" in resolveHarnessConfig({ parallelToolHint: false })).toBe(false);
    // Any other value keeps the default (on, calibration-gated).
    process.env.RA_PARALLEL_TOOL_HINT = "yes";
    expect(resolveHarnessConfig().parallelToolHint).toBe(true);
  });
});

/**
 * A model that batches both lookups in one reply when the hint is in its system
 * prompt, and makes them one per turn otherwise. The choice is made on the
 * first call and kept.
 */
function hintFollowingModel() {
  const batched: TestTurn[] = [
    { toolCalls: [{ id: "w1", name: "weather", args: { city: "Paris" } }, { id: "w2", name: "weather", args: { city: "Tokyo" } }] },
    { text: ANSWER },
  ];
  const sequential: TestTurn[] = [
    { toolCall: { id: "w1", name: "weather", args: { city: "Paris" } } },
    { toolCall: { id: "w2", name: "weather", args: { city: "Tokyo" } } },
    { text: ANSWER },
  ];
  const requests: CompletionRequest[] = [];
  let script: ReturnType<typeof TestLLMService> | undefined;
  const layer = Layer.succeed(
    LLMService,
    LLMService.of({
      ...TestLLMService(sequential),
      complete: (req) => (script ?? TestLLMService([{ text: ANSWER }])).complete(req),
      stream: (req) => {
        requests.push(req);
        script ??= TestLLMService(String(req.systemPrompt ?? "").includes(PARALLEL_TOOL_HINT) ? batched : sequential);
        return script.stream(req);
      },
    }),
  );
  return { layer, requests };
}

const BUDGET = {
  ...defaultReasoningConfig,
  strategies: {
    ...defaultReasoningConfig.strategies,
    reactive: { ...defaultReasoningConfig.strategies.reactive, maxIterations: 6, maxIterationsExplicit: true },
  },
};

/** Occurrences of the batching sentence in a request's system prompt. */
const hintCount = (r: CompletionRequest) => String(r.systemPrompt ?? "").split(PARALLEL_TOOL_HINT).length - 1;

// Local tier by default: its base prompt has no batching sentence (the
// golden-run models gemma4:e4b / qwen3:14b / cogito:14b run there).
async function run(harness: HarnessConfig, parallelCallCapability: string, tier: "local" | "mid" = "local") {
  const model = hintFollowingModel();
  const executed: unknown[] = [];
  const tools = mockToolServiceLayer({
    // The kernel passes the call's arguments as `arguments` (tool-execution.ts).
    execute: (req) => Effect.sync(() => (executed.push((req as { arguments?: unknown }).arguments), { success: true, result: { tempC: executed.length === 1 ? 18 : 24 } })),
    getTool: (name: string) => Effect.succeed({ name, description: "test", parameters: PARAMS }),
  });
  const signals: string[] = [];
  const program = Effect.gen(function* () {
    const bus = yield* EventBus;
    yield* bus.subscribe((ev) =>
      ev._tag === "HarnessSignalInjectedEmitted" ? Effect.sync(() => { signals.push(ev.origin); }) : Effect.void,
    );
    return yield* executeReactive({
      taskDescription: TASK,
      taskType: "research",
      memoryContext: "",
      availableTools: ["weather"],
      availableToolSchemas: [WEATHER],
      config: BUDGET,
      calibration: { modelId: "test", parallelCallCapability },
      contextProfile: { tier },
    } as never);
  });
  const result = await Effect.runPromise(
    provideTestEnvelope(
      program.pipe(Effect.provide(Layer.mergeAll(model.layer, tools, EventBusLive))),
      // The kernel reads the profile off the run envelope (the model facet).
      buildRunEnvelope({ harness, contextProfile: { tier } }),
    ),
  );
  return { result, requests: model.requests, executed, signals };
}

describe("end to end: two independent calls in one turn when hinted", () => {
  it("on + reliable: the prompt carries the hint, both lookups run from ONE think call, one signal per hinted turn", async () => {
    const { result, requests, executed, signals } = await run({ parallelToolHint: true }, "reliable");
    expect(String(requests[0]!.systemPrompt)).toContain(PARALLEL_TOOL_HINT);
    expect(executed).toEqual([{ city: "Paris" }, { city: "Tokyo" }]);
    expect(requests.length).toBe(2); // one tool turn + the answer
    // Both observations landed before the next think: the answer call sees both results.
    const next = JSON.stringify(requests[1]!.messages);
    expect(next).toContain("18");
    expect(next).toContain("24");
    expect(String(result.output ?? "")).toContain(ANSWER);
    expect(signals.filter((o) => o === PARALLEL_TOOL_HINT_ORIGIN).length).toBeGreaterThanOrEqual(1);
  }, 20000);

  it("default (no config): a reliable model gets the hint and batches in ONE tool turn", async () => {
    const { requests, executed, signals } = await run({}, "reliable");
    expect(String(requests[0]!.systemPrompt)).toContain(PARALLEL_TOOL_HINT);
    expect(executed).toEqual([{ city: "Paris" }, { city: "Tokyo" }]);
    expect(requests.length).toBe(2); // one tool turn + the answer
    expect(signals).toContain(PARALLEL_TOOL_HINT_ORIGIN);
  }, 20000);

  it("default (no config): an unreliable-calibration model gets no hint line (calibration gate)", async () => {
    for (const cap of ["partial", "sequential-only"]) {
      const { requests, signals } = await run({}, cap);
      expect(requests.every((r) => !String(r.systemPrompt ?? "").includes(PARALLEL_TOOL_HINT))).toBe(true);
      expect(requests.length).toBe(3);
      expect(signals).not.toContain(PARALLEL_TOOL_HINT_ORIGIN);
    }
  }, 20000);

  it("off (config false): no hint, the same model makes one call per turn", async () => {
    const { requests, executed, signals } = await run({ parallelToolHint: false }, "reliable");
    expect(requests.every((r) => !String(r.systemPrompt ?? "").includes(PARALLEL_TOOL_HINT))).toBe(true);
    expect(executed).toEqual([{ city: "Paris" }, { city: "Tokyo" }]);
    expect(requests.length).toBe(3); // two tool turns + the answer
    expect(signals).not.toContain(PARALLEL_TOOL_HINT_ORIGIN);
  }, 20000);

  it("on, but calibration sequential-only: no hint", async () => {
    const { requests } = await run({ parallelToolHint: true }, "sequential-only");
    expect(requests.every((r) => !String(r.systemPrompt ?? "").includes(PARALLEL_TOOL_HINT))).toBe(true);
    expect(requests.length).toBe(3);
  }, 20000);

  it('"always" forces the hint for a sequential-only model', async () => {
    const { requests } = await run({ parallelToolHint: "always" }, "sequential-only");
    expect(String(requests[0]!.systemPrompt)).toContain(PARALLEL_TOOL_HINT);
    expect(requests.length).toBe(2);
  }, 20000);

  it("mid tier: the default prompt already carries the sentence; on adds no second copy and no signal", async () => {
    const off = await run({ parallelToolHint: false }, "reliable", "mid");
    const on = await run({ parallelToolHint: true }, "reliable", "mid");
    expect(hintCount(off.requests[0]!)).toBe(1);
    expect(hintCount(on.requests[0]!)).toBe(1);
    expect(on.requests[0]!.systemPrompt).toBe(off.requests[0]!.systemPrompt);
    expect(on.signals).not.toContain(PARALLEL_TOOL_HINT_ORIGIN);
  }, 20000);
});
