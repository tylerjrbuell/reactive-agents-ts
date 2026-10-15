// Run: bun test packages/reasoning/tests/kernel/loop/tool-routing-triad.test.ts --timeout 15000
//
// W3b (plan 3.3) — Review Focus #2 TRIAD mutation-pin, end-to-end.
//
// The 482c11e4 divergence class was THREE decisions keyed on TWO signals:
//   leg 1 (derivation floor): provider capabilities().supportsToolCalling —
//           the single fused claim (llm-provider `deriveSupportsToolCalling`
//           already folds the dialect prior + floor into it — the spec's
//           "collapse the two signals into one at the source").
//   leg 2 (select-driver):    selectToolCallingDriver — mode from the SAME
//           claim; the dialect claim rides as provenance, never as a route.
//   leg 3 (resolver injection): runner.ts's ToolCallResolver injection — the
//           SAME claim again.
// `injectResolver ⟺ driverMode === "native-fc" ⟺ attachTools` — the three
// move together or a capable model strands in text-parse (loop to
// maxIterations) / an incapable model gets a resolver that can never fire.
//
// Every arm below drives the REAL runKernel wiring (runner.ts) with a
// context-capturing ThoughtKernel; sever any single leg and the matching arm
// goes red:
//   - caller stops reading caps (hardcoded true/false) → arms 1/2 flip.
//   - selectToolCallingDriver re-keys on dialect → arms 1/2/4/5 flip.
//   - resolver injection keyed on dialect/calibration → arms 2/3 flip.
//   - caller re-reads `input.calibration?.toolCallDialect` (the schema-default
//     phantom, GH #243 class) instead of `loadDialectPriorClaim` → arm 3 flips.
//   - a provisional registry tier starts routing → arm 4 flips.
//
// Meta-tool sentinel arms (bottom describe) pin plan 3.3's other half: the
// native-FC control-plane invariant (think.ts) STRIPS harness/meta sentinels
// from the FC array on native runs and EXEMPTS text-parse runs (post-W3a
// verification — "verify, don't re-fork").
//
// Spec: wiki/Architecture/Design-Specs/2026-06-03-tool-calling-driver-redesign.md
//   §4 Direction A: "Calibration *refines within* native … it does not
//   *downgrade*. Text-parse is reserved for supportsToolCalling === false."
//   §3: "Source-tagged provenance — … so a wrong route is *visible* in
//   telemetry, not silent."

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { Effect, Layer, Option, Stream } from "effect";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { EventBusLive } from "@reactive-agents/core";
import { clearCalibrationCache, LLMService } from "@reactive-agents/llm-provider";
import { NativeFCDriver, TextParseDriver } from "@reactive-agents/tools";
import { runKernel } from "../../../src/kernel/loop/runner.js";
import { handleThinking } from "../../../src/kernel/capabilities/reason/think.js";
import {
  initialKernelState,
  noopHooks,
  transitionState,
  type KernelContext,
  type KernelInput,
  type KernelState,
  type ThoughtKernel,
} from "../../../src/kernel/state/kernel-state.js";
import { CONTEXT_PROFILES } from "../../../src/context/context-profile.js";
import type { ModelCalibration } from "@reactive-agents/llm-provider";

// ─── calibration-prior fixture plumbing ──────────────────────────────────────
// loadDialectPriorClaim reads ~/.reactive-agents/calibrations/<key>.json. The
// HOME env is read per lookup and the result is process-cached, so every arm
// wraps in withDialectPrior() which points HOME at a fresh temp dir and
// clears the claim cache on both ends.

const MODEL_ID = "w3b-triad-model";
const HOME_BACKUP = process.env.HOME;
const CLAIM_KEY = MODEL_ID.toLowerCase().replace(/:/g, "-").replace(/\s+/g, "-");

function withDialectPrior(dialect: string | undefined, runsAveraged: number | undefined): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "w3b-triad-"));
  const calDir = path.join(dir, ".reactive-agents", "calibrations");
  fs.mkdirSync(calDir, { recursive: true });
  if (dialect !== undefined) {
    fs.writeFileSync(
      path.join(calDir, `${CLAIM_KEY}.json`),
      JSON.stringify({
        modelId: MODEL_ID,
        ...(runsAveraged !== undefined ? { runsAveraged } : {}),
        toolCallDialect: dialect,
      }),
    );
  } else {
    // A prior file WITHOUT the field — the schema-default phantom class.
    fs.writeFileSync(path.join(calDir, `${CLAIM_KEY}.json`), JSON.stringify({ modelId: MODEL_ID }));
  }
  process.env.HOME = dir;
  clearCalibrationCache();
}

afterAll(() => {
  if (HOME_BACKUP !== undefined) process.env.HOME = HOME_BACKUP;
  else delete process.env.HOME;
  clearCalibrationCache();
});

// ─── stub LLM with configurable caps + context capture ───────────────────────

interface CapturedRun {
  readonly context: KernelContext;
  readonly state: KernelState;
}

/**
 * The capture kernel: stashes the KernelContext the REAL runner wired, then
 * terminates the loop. Zero behavior beyond "done" (mirrors
 * judgment-comprehend-shadow-wiring.test.ts's doneKernel shape).
 */
function makeCaptureKernel(sink: { current: KernelContext | undefined }): ThoughtKernel {
  return (state, context) => {
    sink.current = context;
    return Effect.succeed(
      transitionState(state, {
        status: "done",
        output: "Paris",
        iteration: state.iteration + 1,
      }),
    );
  };
}

function stubLLM(supportsToolCalling: boolean): Layer.Layer<LLMService> {
  const usage = { inputTokens: 10, outputTokens: 20, totalTokens: 30, estimatedCost: 0 };
  return Layer.succeed(LLMService, {
    complete: () =>
      Effect.succeed({ content: "ok", stopReason: "end_turn", usage, model: "test-model" }) as never,
    stream: () =>
      Effect.succeed(
        Stream.fromIterable([
          { type: "text_delta", text: "ok" },
          { type: "content_complete", content: "ok" },
          { type: "usage", usage },
        ]) as never,
      ),
    completeStructured: () => Effect.succeed({ ok: true }) as never,
    embed: () => Effect.succeed([]),
    countTokens: () => Effect.succeed(0),
    getModelConfig: () => Effect.succeed({} as never),
    getStructuredOutputCapabilities: () => Effect.succeed({} as never),
    capabilities: () =>
      Effect.succeed({
        supportsToolCalling,
        supportsStreaming: true,
        supportsStructuredOutput: false,
        supportsLogprobs: false,
      }),
  } as never);
}

async function captureRunnerContext(input: KernelInput, supportsToolCalling: boolean): Promise<CapturedRun> {
  const sink: { current: KernelContext | undefined } = { current: undefined };
  const state = await Effect.runPromise(
    runKernel(makeCaptureKernel(sink), input, {
      maxIterations: 4,
      strategy: "w3b-triad",
      kernelType: "w3b-triad",
    }).pipe(Effect.provide(Layer.merge(stubLLM(supportsToolCalling), EventBusLive))),
  );
  if (sink.current === undefined) throw new Error("capture kernel never ran");
  return { context: sink.current, state };
}

const WEB_SEARCH_SCHEMA = {
  name: "web-search",
  description: "Search the web for a query.",
  parameters: [
    { name: "query", type: "string", description: "the search text", required: true },
  ],
} as const;

// A calibration object of the shape the schema-default phantom produces:
// field PRESENT with value "none" because ModelCalibrationSchema defaults
// absent → "none" (calibration.ts). Reading it is the re-entry class W3b bans.
function phantomDefaultedCalibration(): ModelCalibration {
  return {
    modelId: MODEL_ID,
    calibratedAt: "2026-10-13",
    probeVersion: 1,
    runsAveraged: 1,
    steeringCompliance: "system-prompt",
    parallelCallCapability: "sequential-only",
    observationHandling: "needs-inline-facts",
    systemPromptAttention: "moderate",
    optimalToolResultChars: 1200,
    toolCallDialect: "none",
  } satisfies ModelCalibration;
}

// ─── THE TRIAD ───────────────────────────────────────────────────────────────

describe("W3b triad: one signal routes — derivation floor, driver, resolver never diverge", () => {
  beforeAll(() => {
    clearCalibrationCache();
  });

  it("arm 1: capable + explicit dialect:none prior ⇒ NATIVE (claim never downgrades) + resolver injected + claim visible", async () => {
    withDialectPrior("none", 5);
    const { context } = await captureRunnerContext(
      { task: "Find the BTC price", availableToolSchemas: [WEB_SEARCH_SCHEMA], modelId: MODEL_ID },
      true,
    );
    // Leg 2 sever (dialect-keyed routing = 482c11e4) would land text-parse here.
    expect(context.toolCallingDriver.mode).toBe("native-fc");
    // Leg 3 sever (resolver re-keyed on the dialect claim) would strip it here.
    expect(context.input.toolCallResolver).toBeDefined();
    // Spec §3 provenance: the wrong-looking claim is VISIBLE, not silent.
    expect(context.toolCallingDriver.dialectClaim).toBe("none");
  });

  it("arm 2: incapable + explicit dialect:native-fc prior ⇒ TEXT-PARSE (capability is master) + NO resolver", async () => {
    withDialectPrior("native-fc", 5);
    const { context } = await captureRunnerContext(
      { task: "Find the BTC price", availableToolSchemas: [WEB_SEARCH_SCHEMA], modelId: MODEL_ID },
      false,
    );
    // Leg 1 sever (caller ignores caps / hardcodes true) lands native-fc here.
    expect(context.toolCallingDriver.mode).toBe("text-parse");
    // Leg 3 sever keyed on the claim ⇒ resolver present on a model that can
    // never emit native FC events — the shadowing branch of the 482c11e4 face.
    expect(context.input.toolCallResolver).toBeUndefined();
    expect(context.toolCallingDriver.dialectClaim).toBe("native-fc");
  });

  it("arm 3 (phantom rule): file WITHOUT the dialect field + schema-defaulted calibration ⇒ NO claim (undefined, not 'none')", async () => {
    withDialectPrior(undefined, undefined); // prior file exists but omits toolCallDialect
    const { context } = await captureRunnerContext(
      {
        task: "Find the BTC price",
        availableToolSchemas: [WEB_SEARCH_SCHEMA],
        modelId: MODEL_ID,
        calibration: phantomDefaultedCalibration(),
      },
      true,
    );
    // GH #243: `calibration.toolCallDialect` is "none" via the SCHEMA DEFAULT —
    // absence is not a claim. Caller wiring reverted to the old read stamps
    // "none" here and this arm goes red.
    expect(context.toolCallingDriver.dialectClaim).toBeUndefined();
    expect(context.toolCallingDriver.mode).toBe("native-fc");
    expect(context.input.toolCallResolver).toBeDefined();
  });

  it("arm 4 (provisionalTier keep-obligation): registry-provisional tier is NOT a routing input", async () => {
    // W2b: `provisionalTier: true` marks a regex-decided tier guess. Wave 3
    // routing must treat it as UNVERIFIED — it (and the local tier it guessed)
    // must not act as registry truth to downgrade a capable model to the
    // degraded route, even alongside an explicit none-claim.
    withDialectPrior("none", 5);
    const { context } = await captureRunnerContext(
      {
        task: "Find the BTC price",
        availableToolSchemas: [WEB_SEARCH_SCHEMA],
        modelId: MODEL_ID,
        contextProfile: { ...CONTEXT_PROFILES.local, provisionalTier: true },
      },
      true,
    );
    expect(context.profile.provisionalTier).toBe(true);
    expect(context.toolCallingDriver.mode).toBe("native-fc");
    expect(context.input.toolCallResolver).toBeDefined();
  });

  it("arm 5 (W2a floor semantics live at the claim producer): sub-floor explicit claim rides as provenance, routes by capability anyway", async () => {
    // A present-but-low-confidence claim (runsAveraged 0) is STILL explicit at
    // this seam: the floor gates whether the claim may alter the CAPABILITY
    // derivation (local.ts deriveSupportsToolCalling, DIALECT_PRIOR_CONFIDENCE
    // _FLOOR). Re-applying the floor at selection would re-create the second
    // arbiter design law #1 forbids — so selection just makes the claim
    // visible. Capable ⇒ native regardless.
    withDialectPrior("none", 0);
    const { context } = await captureRunnerContext(
      { task: "Find the BTC price", availableToolSchemas: [WEB_SEARCH_SCHEMA], modelId: MODEL_ID },
      true,
    );
    expect(context.toolCallingDriver.mode).toBe("native-fc");
    expect(context.toolCallingDriver.dialectClaim).toBe("none");
    expect(context.input.toolCallResolver).toBeDefined();
  });
});

// ─── Sentinel exemption (plan 3.3 item 3) — verify post-W3a, don't re-fork ───

interface ThinkStreamRequest {
  readonly systemPrompt?: string;
  readonly tools?: readonly { readonly name: string }[];
}

async function runThinkCapture(driver: NativeFCDriver | TextParseDriver): Promise<ThinkStreamRequest> {
  const captured: ThinkStreamRequest[] = [];
  const usage = { inputTokens: 10, outputTokens: 20, totalTokens: 30, estimatedCost: 0 };
  const llm = Layer.succeed(LLMService, {
    complete: () =>
      Effect.succeed({ content: "ok", stopReason: "end_turn", usage, model: "test-model" }) as never,
    stream: (req: ThinkStreamRequest) => {
      captured.push(req);
      return Effect.succeed(
        Stream.fromIterable([
          { type: "text_delta", text: "thinking out loud, no markup" },
          { type: "content_complete", content: "thinking out loud, no markup" },
          { type: "usage", usage },
        ]) as never,
      );
    },
    completeStructured: () => Effect.succeed({ ok: true }) as never,
    embed: () => Effect.succeed([]),
    countTokens: () => Effect.succeed(0),
    getModelConfig: () => Effect.succeed({} as never),
    getStructuredOutputCapabilities: () => Effect.succeed({} as never),
    capabilities: () => Effect.succeed({} as never),
  } as never);

  const input: KernelInput = {
    task: "Find the BTC price",
    availableToolSchemas: [
      WEB_SEARCH_SCHEMA,
      { name: "context-status", description: "Report the current context window status.", parameters: [] },
    ],
  };
  const profile = CONTEXT_PROFILES.mid;
  const context: KernelContext = {
    input,
    profile,
    compression: { budget: profile.toolResultMaxChars ?? 800, previewItems: 5, autoStore: true, codeTransform: true },
    toolService: Option.none(),
    hooks: noopHooks,
    toolCallingDriver: driver,
    memoryService: Option.none(),
  };
  const state = {
    ...initialKernelState({ strategy: "reactive", kernelType: "reactive", maxIterations: 4, taskId: "w3b-sentinel" }),
    messages: [{ role: "user" as const, content: "Find the BTC price" }],
  };
  await Effect.runPromise(handleThinking(state, context).pipe(Effect.provide(Layer.merge(llm, EventBusLive))));
  const thinkReq = captured[0];
  if (thinkReq === undefined) throw new Error("think never issued a stream request");
  return thinkReq;
}

describe("W3b sentinel pin: meta-tool sentinels STAY in the tools array for text-parse runs (think.ts control-plane exemption holds post-W3a)", () => {
  it("text-parse run: harness/meta sentinels are taught — nothing was re-forked to strip them", async () => {
    const req = await runThinkCapture(new TextParseDriver());
    // Text-parse sends NO wire tools array (instruct ≠ FC) — the sentinels ride
    // in the driver's taught tool listing instead, and `context-status` (a
    // META_TOOLS member) must still be there: it is load-bearing control for a
    // model that cannot signal termination by response shape. (A `recall`
    // probe would hit the independent recall-overflow gate, not the
    // control-plane filter — hence the ungated meta sentinel.)
    expect(req.tools).toBeUndefined();
    expect(req.systemPrompt).toContain("Tool: context-status");
    expect(req.systemPrompt).toContain("Tool: web-search");
  });

  it("native-FC run: the SAME invariant strips the sentinel from the FC array (exemption is mode-scoped, not dead code)", async () => {
    const req = await runThinkCapture(new NativeFCDriver());
    const names = (req.tools ?? []).map((t) => t.name);
    expect(names).toContain("web-search");
    expect(names).not.toContain("context-status");
  });
});

describe("W3 rung-2: REACTIVE_AGENTS_FORCE_TEXT_PARSE forces the text-parse route on a capable model", () => {
  const KEY = "REACTIVE_AGENTS_FORCE_TEXT_PARSE";
  let prev: string | undefined;

  beforeEach(() => {
    prev = process.env[KEY];
  });

  afterEach(() => {
    if (prev === undefined) delete process.env[KEY];
    else process.env[KEY] = prev;
  });

  it("capable provider + flag=1 ⇒ TEXT-PARSE driver + NO native resolver (no 482c11e4 divergence)", async () => {
    process.env[KEY] = "1";
    withDialectPrior("native-fc", 5);
    const { context } = await captureRunnerContext(
      { task: "Find the BTC price", availableToolSchemas: [WEB_SEARCH_SCHEMA], modelId: MODEL_ID },
      true,
    );
    expect(context.toolCallingDriver.mode).toBe("text-parse");
    expect(context.input.toolCallResolver).toBeUndefined();
  });

  it("capable provider + flag unset ⇒ NATIVE driver + resolver (default unchanged)", async () => {
    delete process.env[KEY];
    withDialectPrior("native-fc", 5);
    const { context } = await captureRunnerContext(
      { task: "Find the BTC price", availableToolSchemas: [WEB_SEARCH_SCHEMA], modelId: MODEL_ID },
      true,
    );
    expect(context.toolCallingDriver.mode).toBe("native-fc");
    expect(context.input.toolCallResolver).toBeDefined();
  });
});
