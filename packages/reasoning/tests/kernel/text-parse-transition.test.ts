// Run: bun test packages/reasoning/tests/kernel/text-parse-transition.test.ts --timeout 15000
//
// W3a Stage B — the text-parse think→acting transition (spec
// wiki/Architecture/Design-Specs/2026-06-03-tool-calling-driver-redesign.md,
// IMPLEMENT slice). A model MEASURED as tool-call-incapable
// (`supportsToolCalling === false` → `TextParseDriver`) must STILL be able to
// dispatch tools, not burn maxIterations emitting markup nothing parses
// (the S4/qwen2.5-coder defect class).
//
// Flag: REACTIVE_AGENTS_TEXT_PARSE=off|shadow|act, default off = today's
// behavior byte-unchanged (arm 5). ONE decision point:
// kernel/utils/text-parse-mode.ts, read by think.ts only.
//
// TEACH/PARSE SINGLE SOURCE (GH #243 root lesson, binding): the model
// responses below are DERIVED from the live
// `TextParseDriver.buildPromptInstructions()` output — the example block's
// literal lines with placeholders filled positionally. Nothing about the
// grammar is hand-typed: if the builder's taught shape and the parser
// diverge, these tests break and the builder is truth.
//
// No second dispatch path: the act-mode transition lands on the SAME
// `handleActing` flow the native branch uses — guard chain, policy choke
// point, HealingPipeline, ledger seam (step projection untouched; only
// existing ledger kinds).

import { describe, it, expect } from "bun:test";
import { Effect, Layer, Option, Stream } from "effect";
import { EventBus, EventBusLive } from "@reactive-agents/core";
import { LLMService } from "@reactive-agents/llm-provider";
import { NativeFCDriver, TextParseDriver } from "@reactive-agents/tools";
import { handleThinking } from "../../src/kernel/capabilities/reason/think.js";
import { handleActing } from "../../src/kernel/capabilities/act/act.js";
import {
  initialKernelState,
  noopHooks,
  type KernelContext,
  type KernelInput,
  type KernelState,
  type ToolServiceInstance,
} from "../../src/kernel/state/kernel-state.js";
import { CONTEXT_PROFILES } from "../../src/context/context-profile.js";

const ENV_FLAG = "REACTIVE_AGENTS_TEXT_PARSE";

// ─── the taught grammar, as the LIVE builder emits it ────────────────────────

const WEB_SEARCH_SCHEMA = {
  name: "web-search",
  description: "Search the web for a query.",
  parameters: [
    { name: "query", type: "string", description: "the search text", required: true },
  ],
};

const textParseDriver = new TextParseDriver();
const TAUGHT = textParseDriver.buildPromptInstructions([WEB_SEARCH_SCHEMA]);

/** Replace each `<...>` placeholder in a taught line, positionally. */
function fillTaughtLine(line: string, values: readonly string[]): string {
  let i = 0;
  return line.replace(/<[^>\n]+>/g, () => values[i++] ?? "");
}

/**
 * Build a model response BY INSTANTIATING the example block found inside the
 * live builder's taught instructions — never a hand-typed shape. The block's
 * open/close marker lines are taken verbatim; the tool line's first
 * placeholder becomes `toolName`; each following line's successive
 * placeholders become (param name, param value) from `args`.
 */
function taughtShapeCall(
  toolName: string,
  args: readonly (readonly [string, string])[],
): string {
  const blockMatch = TAUGHT.match(/<tool_call>[\s\S]*?<\/tool_call>/);
  expect(blockMatch).not.toBeNull();
  const lines = blockMatch![0].split("\n");
  const open = lines[0]!;
  const close = lines[lines.length - 1]!;
  const toolLine = fillTaughtLine(lines[1]!, [toolName]);
  const paramLines = lines
    .slice(2, lines.length - 1)
    .map((line, j) => fillTaughtLine(line, args[j] !== undefined ? [args[j]![0], args[j]![1]] : []));
  return [open, toolLine, ...paramLines, close].join("\n");
}

function respondInTaughtShape(
  toolName: string,
  args: readonly (readonly [string, string])[],
  prose = "I will look that up.",
): string {
  return [prose, taughtShapeCall(toolName, args)].join("\n");
}

/** The marker lines verbatim from the taught block, with an unparseable body. */
function malformedTaughtMarkup(): string {
  const blockMatch = TAUGHT.match(/<tool_call>[\s\S]*?<\/tool_call>/);
  expect(blockMatch).not.toBeNull();
  const lines = blockMatch![0].split("\n");
  return [
    "I will act now.",
    lines[0]!,
    "please just search the btc price thanks",
    lines[lines.length - 1]!,
  ].join("\n");
}

// ─── stubs + harness plumbing (patterns lifted from forbidden-tools.test.ts,
// ─── act-single-equivalence.test.ts, completion-judgment-shadow.test.ts) ─────

function stubLLM(content: string): Layer.Layer<LLMService> {
  const usage = { inputTokens: 10, outputTokens: 20, totalTokens: 30, estimatedCost: 0 };
  return Layer.succeed(LLMService, {
    complete: () =>
      Effect.succeed({ content, stopReason: "end_turn", usage, model: "test-model" }) as never,
    stream: () =>
      Effect.succeed(
        Stream.fromIterable([
          { type: "text_delta", text: content },
          { type: "content_complete", content },
          { type: "usage", usage },
        ]) as never,
      ),
    completeStructured: () => Effect.succeed({ ok: true }) as never,
    embed: () => Effect.succeed([]),
    countTokens: () => Effect.succeed(0),
    getModelConfig: () => Effect.succeed({} as never),
    getStructuredOutputCapabilities: () => Effect.succeed({} as never),
    capabilities: () => Effect.succeed({} as never),
  } as never);
}

const THINK_INPUT: KernelInput = {
  task: "Find the BTC price",
  availableToolSchemas: [WEB_SEARCH_SCHEMA],
};

function thinkContext(driver: KernelContext["toolCallingDriver"]): KernelContext {
  return {
    input: THINK_INPUT,
    profile: CONTEXT_PROFILES.local,
    compression: { budget: 800, previewItems: 5, autoStore: true, codeTransform: true },
    toolService: Option.none(),
    hooks: noopHooks,
    toolCallingDriver: driver,
    memoryService: Option.none(),
  };
}

function freshState(): KernelState {
  return {
    ...initialKernelState({ strategy: "reactive", kernelType: "reactive", maxIterations: 8 }),
    messages: [{ role: "user" as const, content: "Find the BTC price" }],
  };
}

type CapturedSignal = {
  readonly origin: string;
  readonly signalKind: string;
  readonly contentPreview: string;
  readonly metadata?: Record<string, unknown>;
};

/**
 * Set the flag for the duration of `fn` (save/restore per the
 * build-kernel-input.test.ts env pattern), drive the REAL think phase against
 * a canned `content` response, and capture every
 * `HarnessSignalInjectedEmitted` event the run publishes.
 */
async function runThinkWithFlag(
  flag: string | undefined,
  driver: KernelContext["toolCallingDriver"],
  content: string,
): Promise<{ readonly state: KernelState; readonly signals: readonly CapturedSignal[] }> {
  const prev = process.env[ENV_FLAG];
  if (flag === undefined) delete process.env[ENV_FLAG];
  else process.env[ENV_FLAG] = flag;
  try {
    const signals: CapturedSignal[] = [];
    const state = freshState();
    let result: KernelState | undefined;
    await Effect.runPromise(
      Effect.gen(function* () {
        const eb = yield* EventBus;
        yield* eb.on("HarnessSignalInjectedEmitted", (event) =>
          Effect.sync(() => {
            signals.push({
              origin: event.origin,
              signalKind: event.signalKind,
              contentPreview: event.contentPreview,
              metadata: event.metadata,
            });
          }),
        );
        result = yield* handleThinking(state, thinkContext(driver));
        // Let the bus dispatch settle before the subscription scope closes.
        yield* Effect.sleep("50 millis");
      }).pipe(Effect.provide(Layer.merge(EventBusLive, stubLLM(content)))),
    );
    return { state: result!, signals };
  } finally {
    if (prev === undefined) delete process.env[ENV_FLAG];
    else process.env[ENV_FLAG] = prev;
  }
}

interface ExecutedCall {
  readonly toolName: string;
  readonly arguments: Record<string, unknown>;
}

function recordingToolService(calls: ExecutedCall[]): Option.Option<ToolServiceInstance> {
  // Same stub shape as act-single-equivalence.test.ts's successToolService()
  // (typed without widening) — records each execute for identity assertions.
  return Option.some({
    execute: (req: { toolName: string; arguments: Record<string, unknown> }) => {
      calls.push({ toolName: req.toolName, arguments: req.arguments });
      return Effect.succeed({ success: true, result: { hits: 3, query: req.toolName } });
    },
    getTool: () => Effect.fail(new Error("no schema")),
    listTools: () => Effect.succeed([]),
  });
}

function actContext(driver: KernelContext["toolCallingDriver"], calls: ExecutedCall[]): KernelContext {
  const profile = CONTEXT_PROFILES.mid;
  return {
    input: THINK_INPUT,
    profile,
    compression: { budget: profile.toolResultMaxChars ?? 800, previewItems: 3, autoStore: true, codeTransform: true },
    toolService: recordingToolService(calls),
    hooks: noopHooks,
    toolCallingDriver: driver,
    memoryService: Option.none(),
  };
}

function actingState(meta: KernelState["meta"]): KernelState {
  return {
    ...initialKernelState({ strategy: "react-kernel", kernelType: "react", maxIterations: 3, taskId: "w3a-act" }),
    status: "acting",
    meta,
  };
}

const runActing = async (state: KernelState, driver: KernelContext["toolCallingDriver"], calls: ExecutedCall[]) =>
  Effect.runPromise(handleActing(state, actContext(driver, calls)).pipe(Effect.provide(stubLLM("ok"))));

// ─── ARM 1 — teach/parse round trip from the BUILDER'S OWN shape ─────────────

describe("W3a arm 1: builder-taught shape round-trips into a parsed call", () => {
  it("the shape instantiated from buildPromptInstructions() parses via the same driver", () => {
    const response = respondInTaughtShape("web-search", [["query", "btc price"]]);
    const parsed = textParseDriver.extractCalls(response, [WEB_SEARCH_SCHEMA]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.name).toBe("web-search");
    expect(parsed[0]!.arguments).toEqual({ query: "btc price" });
  });

  it("act mode: handleThinking transitions to acting on the builder-taught shape", async () => {
    const response = respondInTaughtShape("web-search", [["query", "btc price"]]);
    const { state } = await runThinkWithFlag("act", textParseDriver, response);
    expect(state.status).toBe("acting");
    // The transition carries the current text on meta.lastThought (native
    // convention) so act.ts's extractCalls seam sees THIS turn's markup.
    expect(state.meta.lastThought).toBe(response);
  }, 15000);
});

// ─── ARM 2 — shadow records the parse-diff WITHOUT acting ────────────────────

describe("W3a arm 2: shadow mode records parse-diff, never dispatches", () => {
  it("parsed calls are recorded as a parse-diff event; status is NOT acting", async () => {
    const response = respondInTaughtShape("web-search", [["query", "btc price"]]);
    const { state, signals } = await runThinkWithFlag("shadow", textParseDriver, response);
    expect(state.status).not.toBe("acting");
    const shadow = signals.filter((s) => s.origin === "text-parse-shadow");
    expect(shadow).toHaveLength(1);
    const meta = shadow[0]!.metadata!;
    expect(meta["textParseMode"]).toBe("shadow");
    expect(meta["acted"]).toBe(false);
    expect(meta["markerPresent"]).toBe(true);
    const parsed = meta["parsedCalls"] as readonly { name: string; parseMode: string }[];
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.name).toBe("web-search");
  }, 15000);

  it("shadow adds NO dispatch step and no guidance (observation-unchanged)", async () => {
    const response = respondInTaughtShape("web-search", [["query", "btc price"]]);
    const { state } = await runThinkWithFlag("shadow", textParseDriver, response);
    expect(state.pendingGuidance).toBeUndefined();
    const textParseObs = state.steps.filter(
      (s) => s.type === "observation" && s.content.includes("text-parse"),
    );
    expect(textParseObs).toHaveLength(0);
  }, 15000);
});

// ─── ARM 3 — act-mode parsed calls traverse the SAME acting pipeline ─────────
// The native run and the text-parse run must be indistinguishable to every
// downstream consumer: executed call, action/observation step shape, ledger
// kind sequence, post-acting status. The markup ALSO names the tool with an
// edit-distance-1 typo (`websearch`) so passing the run proves the
// HealingPipeline seam (act.ts healCall) is on the text-parse path too.

describe("W3a arm 3: act-mode dispatch identity with the native path", () => {
  const nativeCalls: ExecutedCall[] = [];
  const textCalls: ExecutedCall[] = [];

  const nativeState = actingState({
    pendingNativeToolCalls: [
      { id: "tc-native-1", name: "web-search", arguments: { query: "btc price" } },
    ],
    lastThought: "I will search.",
    lastThinking: null,
  });
  const markup = respondInTaughtShape("websearch", [["query", "btc price"]]);
  const textState = actingState({ lastThought: markup, lastThinking: null });

  it("text-parse lastThought markup extracts, heals, and executes the tool", async () => {
    const next = await runActing(textState, textParseDriver, textCalls);
    // Extracted by act.ts's own extractCalls seam (reached, not orphaned) and
    // healed by the shared HealingPipeline: websearch → web-search.
    expect(textCalls).toHaveLength(1);
    expect(textCalls[0]!.toolName).toBe("web-search");
    expect(textCalls[0]!.arguments).toEqual({ query: "btc price" });
    // Acting left the status machine — same round-trip native does.
    expect(next.status).not.toBe("acting");
    expect(next.status).not.toBe("done");
  }, 15000);

  it("native baseline executes the same call (reference run)", async () => {
    const next = await runActing(nativeState, new NativeFCDriver(), nativeCalls);
    expect(nativeCalls).toHaveLength(1);
    expect(nativeCalls[0]!.toolName).toBe("web-search");
    expect(next.status).not.toBe("acting");
  }, 15000);

  it("event shapes are IDENTICAL: steps metadata + ledger kind sequence", async () => {
    const nextText = await runActing(textState, textParseDriver, []);
    const nextNative = await runActing(nativeState, new NativeFCDriver(), []);

    const obsOf = (s: KernelState) =>
      s.steps.filter((x) => x.type === "observation" && x.metadata?.toolCallId !== undefined);
    const actOf = (s: KernelState) => s.steps.filter((x) => x.type === "action");

    expect(obsOf(nextText)).toHaveLength(1);
    expect(obsOf(nextNative)).toHaveLength(1);
    expect(actOf(nextText)).toHaveLength(1);
    expect(actOf(nextNative)).toHaveLength(1);

    // Same metadata key set on the observation step (the ledger projects from
    // these; identical shape ⇒ identical ledger kinds).
    expect(Object.keys(obsOf(nextText)[0]!.metadata!).sort()).toEqual(
      Object.keys(obsOf(nextNative)[0]!.metadata!).sort(),
    );
    // Same action-step content grammar: `name({args})`.
    expect(actOf(nextText)[0]!.content).toBe(actOf(nextNative)[0]!.content);

    // Ledger: same kind sequence through the UNTOUCHED projection seam.
    const kinds = (s: KernelState) => (s.ledger ?? []).map((e) => e.kind);
    expect(kinds(nextText)).toEqual(kinds(nextNative));
    expect(kinds(nextText)).toContain("tool-invocation");
    expect(kinds(nextText)).toContain("tool-result");

    // Text-parse call ids carry the driver's `text-parse-` prefix (stable,
    // iteration-scoped ids — the only intentional divergence from native).
    expect(String(obsOf(nextText)[0]!.metadata!.toolCallId)).toMatch(/^text-parse-/);
  }, 15000);
});

// ─── ARM 4 — parse failure in act mode is an observation, never silence ──────

describe("W3a arm 4: act-mode parse failure loops deterministically", () => {
  it("markup that will not parse → observation-shaped message back into the loop", async () => {
    const response = malformedTaughtMarkup();
    const { state, signals } = await runThinkWithFlag("act", textParseDriver, response);

    expect(state.status).not.toBe("acting");
    // Never silent: a deterministic observation step (ledger-visible via the
    // existing observation → tool-result projection) …
    const failObs = state.steps.filter(
      (s) => s.type === "observation" && s.content.includes("text-parse"),
    );
    expect(failObs).toHaveLength(1);
    const obsResult = failObs[0]!.metadata?.observationResult as
      | { success?: boolean }
      | undefined;
    expect(obsResult?.success).toBe(false);
    // … and a guidance channel (house rule: pendingGuidance, never a stray
    // USER message) so the next think carries the retry instruction.
    expect(state.pendingGuidance?.errorRecovery).toInclude("tool_call");
    // The loop advanced (iteration + 1) instead of stalling.
    expect(state.iteration).toBe(1);
    // … plus a trace-visible diagnostic event.
    const failSignals = signals.filter((s) => s.origin === "text-parse-parse-failure");
    expect(failSignals).toHaveLength(1);
    expect(failSignals[0]!.metadata?.["markerPresent"]).toBe(true);
    expect(failSignals[0]!.metadata?.["acted"]).toBe(false);
  }, 15000);
});

// ─── ARM 5 — default OFF is byte-unchanged behavior ──────────────────────────

describe("W3a arm 5: flag unset (default off) changes nothing", () => {
  it("no transition, no event, no extra step on the same markup response", async () => {
    const response = respondInTaughtShape("web-search", [["query", "btc price"]]);
    const { state, signals } = await runThinkWithFlag(undefined, textParseDriver, response);
    expect(state.status).not.toBe("acting");
    expect(signals.filter((s) => s.origin.startsWith("text-parse-"))).toHaveLength(0);
    expect(
      state.steps.filter((s) => s.type === "observation" && s.content.includes("text-parse")),
    ).toHaveLength(0);
    expect(state.pendingGuidance?.errorRecovery).toBeUndefined();
  }, 15000);

  it("an explicit invalid value behaves as off", async () => {
    const response = respondInTaughtShape("web-search", [["query", "btc price"]]);
    const { state, signals } = await runThinkWithFlag("yes-please", textParseDriver, response);
    expect(state.status).not.toBe("acting");
    expect(signals.filter((s) => s.origin.startsWith("text-parse-"))).toHaveLength(0);
  }, 15000);
});
