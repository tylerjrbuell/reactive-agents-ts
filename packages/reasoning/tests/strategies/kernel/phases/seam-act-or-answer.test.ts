// Run: bun test packages/reasoning/tests/strategies/kernel/phases/seam-act-or-answer.test.ts --timeout 15000
//
// Seam pin for kernel/capabilities/reason/act-or-answer.ts (harness switch
// `actOrAnswer`, default OFF). A native-FC think turn that ends in prose while
// tool work is outstanding is re-asked ONCE in the same turn with
// `toolChoice: "required"`; a call it returns proceeds through the normal act
// hand-off, otherwise the original reply is handled as before. Synthetic
// fixtures only: a scripted LLM that answers prose to an unforced request and
// (optionally) a tool call to a forced one.

import { describe, expect, it } from "bun:test";
import { Effect, Layer, Option, Stream } from "effect";
import {
  LLMError,
  LLMService,
  type CompletionRequest,
  type CompletionResponse,
  type StreamEvent,
  type StructuredCompletionRequest,
} from "@reactive-agents/llm-provider";
import { EventBus, EventBusLive } from "@reactive-agents/core";
import { NativeFCDriver, NativeFCStrategy } from "@reactive-agents/tools";
import { handleThinking } from "../../../../src/kernel/capabilities/reason/think.js";
import { handleActing } from "../../../../src/kernel/capabilities/act/act.js";
import {
  ACT_OR_ANSWER_ACTOR,
  actOrAnswerLatched,
  effectiveActOrAnswerMode,
  forcingDropsThinking,
  isNoCallStall,
  lastToolCallFailed,
  outstandingToolWork,
  shouldActOrAnswer,
  shouldForceFirstRequest,
  type ActOrAnswerTrigger,
  type ProactiveTrigger,
} from "../../../../src/kernel/capabilities/reason/act-or-answer.js";
import type { ActOrAnswerSetting } from "../../../../src/harness-config.js";
import { actOrAnswerTally } from "../../../../src/kernel/capabilities/reason/act-or-answer-tally.js";
import { kernelTerminalMetadata } from "../../../../src/strategies/substrate/strategy-run.js";
import { makeObservationResult } from "../../../../src/kernel/utils/observation-helpers.js";
import {
  initialKernelState,
  noopHooks,
  type KernelContext,
  type KernelInput,
  type KernelState,
} from "../../../../src/kernel/state/kernel-state.js";
import { CONTEXT_PROFILES } from "../../../../src/context/context-profile.js";
import { resolveHarnessConfig } from "../../../../src/harness-config.js";
import { makeStep } from "../../../../src/kernel/capabilities/sense/step-utils.js";
import { toolCalled } from "../../../../src/kernel/capabilities/verify/post-conditions.js";
import type { ToolSchema } from "../../../../src/kernel/capabilities/attend/tool-formatting.js";

const PROSE = "I would look this up, but I believe the value is around forty two.";
const SEARCH: ToolSchema = {
  name: "web-search",
  description: "Search the web for a query. Returns ranked results.",
  parameters: [{ name: "query", type: "string", description: "the query", required: true }],
};
const FETCH: ToolSchema = {
  name: "http-get",
  description: "Fetch a URL.",
  parameters: [{ name: "url", type: "string", description: "the url", required: true }],
};

const usage = { inputTokens: 10, outputTokens: 5, totalTokens: 15, estimatedCost: 0 };
const proseEvents: readonly StreamEvent[] = [
  { type: "text_delta", text: PROSE },
  { type: "content_complete", content: PROSE, stopReason: "end_turn" },
  { type: "usage", usage },
];
const callEvents = (name: string, args: Record<string, unknown>): readonly StreamEvent[] => [
  { type: "tool_use_start", id: "forced-1", name },
  { type: "tool_use_delta", input: JSON.stringify(args) },
  { type: "content_complete", content: "", stopReason: "tool_use" },
  { type: "usage", usage },
];

/** Scripted LLM: `unforced` (default prose) for an unforced request; `forced` events when toolChoice is "required" ("fail" = provider error). */
function scriptedLLM(captured: CompletionRequest[], forced: readonly StreamEvent[] | "fail", unforced: readonly StreamEvent[] = proseEvents) {
  return Layer.succeed(
    LLMService,
    LLMService.of({
      complete: (_r: CompletionRequest) =>
        Effect.succeed<CompletionResponse>({ content: "", stopReason: "end_turn", usage, model: "test" }),
      stream: (request: CompletionRequest) => {
        captured.push(request);
        if (request.toolChoice === "required" && forced === "fail") {
          return Effect.fail(new LLMError({ message: "tool_choice rejected", provider: "anthropic" }));
        }
        return Effect.succeed(Stream.fromIterable(request.toolChoice === "required" && forced !== "fail" ? forced : unforced));
      },
      completeStructured: <A>(_r: StructuredCompletionRequest<A>) => Effect.die("unused"),
      embed: (t: readonly string[]) => Effect.succeed(t.map(() => [0])),
      countTokens: (m: readonly unknown[]) => Effect.succeed(m.length),
      getModelConfig: () => Effect.succeed({ provider: "anthropic", model: "test-model" }),
      getStructuredOutputCapabilities: () =>
        Effect.succeed({ nativeJsonMode: false, jsonSchemaEnforcement: false, prefillSupport: false, grammarConstraints: false }),
      capabilities: () =>
        Effect.succeed({ supportsToolCalling: true, supportsStreaming: true, supportsSystemPrompt: true, supportsLogprobs: false, supportsNativeStreaming: true, supportsPromptCaching: false }),
    }),
  );
}

interface Arm {
  readonly on: ActOrAnswerSetting;
  readonly input?: Partial<KernelInput>;
  readonly state?: Partial<KernelState>;
  readonly forced?: readonly StreamEvent[] | "fail";
  /** The reply to an unforced request (default: prose). */
  readonly unforced?: readonly StreamEvent[];
  readonly profile?: KernelContext["profile"];
}

function context(arm: Arm): KernelContext {
  return {
    input: {
      task: "Find the current value with web-search and report it.",
      availableToolSchemas: [SEARCH, FETCH],
      requiredTools: ["web-search"],
      providerName: "anthropic",
      modelId: "test-model",
      toolCallResolver: new NativeFCStrategy(),
      harness: resolveHarnessConfig({ lazyDisclosure: false, actOrAnswer: arm.on }),
      ...arm.input,
    },
    profile: arm.profile ?? CONTEXT_PROFILES.mid,
    compression: { budget: 800, previewItems: 5, autoStore: true, codeTransform: true },
    toolService: Option.none(),
    hooks: noopHooks,
    toolCallingDriver: new NativeFCDriver(),
    memoryService: Option.none(),
  };
}

function startState(arm: Arm): KernelState {
  const base = initialKernelState({ strategy: "reactive", kernelType: "reactive", maxIterations: 10 });
  return {
    ...base,
    iteration: 2,
    messages: [{ role: "user", content: "Find the current value with web-search and report it." }],
    ...arm.state,
  };
}

type Fired = { readonly outcome: string; readonly metadata?: Record<string, unknown> };

async function think(arm: Arm): Promise<{ state: KernelState; requests: CompletionRequest[]; fired: Fired[] }> {
  const requests: CompletionRequest[] = [];
  const fired: Fired[] = [];
  const program = Effect.gen(function* () {
    const bus = yield* EventBus;
    yield* bus.subscribe((ev) =>
      ev._tag === "GuardFiredEmitted" && ev.guard === ACT_OR_ANSWER_ACTOR
        ? Effect.sync(() => { fired.push({ outcome: ev.outcome, metadata: ev.metadata }); })
        : Effect.void,
    );
    return yield* handleThinking(startState(arm), context(arm));
  });
  const state = await Effect.runPromise(
    program.pipe(
      Effect.provide(Layer.merge(scriptedLLM(requests, arm.forced ?? callEvents("web-search", { query: "current value" }), arm.unforced), EventBusLive)),
    ),
  );
  return { state, requests, fired };
}

const records = (s: KernelState) =>
  s.steps.filter((st) => st.type === "harness_signal" && st.metadata?.intervention?.actor === ACT_OR_ANSWER_ACTOR);
const lastText = (r: CompletionRequest): string => {
  const last = r.messages[r.messages.length - 1];
  return last !== undefined && typeof last.content === "string" ? last.content : "";
};

describe("act-or-answer — forced retry on a no-call turn with tool work outstanding", () => {
  it("fires on a prose turn with a missing required tool: one forced request over the callable set", async () => {
    const { state, requests } = await think({ on: true });
    expect(requests).toHaveLength(2);
    const [first, forced] = requests;
    expect(first!.toolChoice).toBeUndefined();
    expect(forced!.toolChoice).toBe("required");
    const firstNames = (first!.tools ?? []).map((t) => t.name);
    const forcedNames = (forced!.tools ?? []).map((t) => t.name);
    expect(firstNames).toContain("web-search");
    // The forced set is the turn's callable wire set (+ final-answer only when offered).
    expect(forcedNames.filter((n) => n !== "final-answer")).toEqual(firstNames);
    // Native-FC prompts carry no tool reference: the forced tail names the tools.
    expect(lastText(forced!)).toContain("[Harness] Work is still outstanding (web-search)");
    expect(lastText(forced!)).toContain("- web-search: Search the web for a query.");
    expect(lastText(first!)).not.toContain("Work is still outstanding");
    // The forced call is the turn's call: the normal act hand-off.
    expect(state.status).toBe("acting");
    expect(state.meta.pendingNativeToolCalls?.map((c) => c.name)).toEqual(["web-search"]);
    expect(state.meta.pendingNativeToolCalls?.[0]?.arguments).toEqual({ query: "current value" });
    expect(records(state)).toHaveLength(1);
    // Both calls are billed.
    expect(state.tokens).toBe(30);
  }, 15000);

  it("final-answer joins the forced set only when the turn offers it; a forced answer is recorded as answered", async () => {
    const { state, requests } = await think({
      on: true,
      input: { requiredTools: [] },
      state: {
        evidence: { successfulCounts: { "web-search": 1 }, attemptedCounts: { "web-search": 1 }, permanentlyFailed: [], substantive: true, seeded: false },
        toolsUsed: new Set(["web-search"]),
        meta: { ...startState({ on: true }).meta, postConditions: [toolCalled("http-get")] },
      },
      forced: callEvents("final-answer", { output: "forty two", format: "text", summary: "done" }),
    });
    expect(requests).toHaveLength(2);
    expect((requests[0]!.tools ?? []).map((t) => t.name)).not.toContain("final-answer");
    expect((requests[1]!.tools ?? []).map((t) => t.name)).toContain("final-answer");
    expect(lastText(requests[1]!)).toContain("outstanding (http-get)");
    expect(records(state)[0]?.metadata?.intervention?.whatChanged).toContain("final-answer");
  }, 15000);

  it("the forced call runs through the normal act path", async () => {
    const { state } = await think({ on: true });
    const acted = await Effect.runPromise(
      handleActing(state, context({ on: true })).pipe(Effect.provide(scriptedLLM([], proseEvents))),
    );
    const action = acted.steps.find((s) => s.type === "action");
    expect(action?.metadata?.toolCall?.name).toBe("web-search");
    expect(acted.steps.some((s) => s.type === "observation")).toBe(true);
  }, 15000);

  it("forced reply with no call: the original reply is handled unchanged", async () => {
    const noCall: readonly StreamEvent[] = [
      { type: "content_complete", content: "still no call", stopReason: "end_turn" },
      { type: "usage", usage },
    ];
    const on = await think({ on: true, forced: noCall });
    const off = await think({ on: false });
    expect(on.requests).toHaveLength(2);
    const thoughts = (s: KernelState) => s.steps.filter((st) => st.type === "thought").map((st) => st.content);
    expect(thoughts(on.state)).toEqual(thoughts(off.state));
    expect(on.state.status).toBe(off.state.status);
    expect(records(on.state)).toHaveLength(1);
  }, 15000);

  it("latch: no second retry in the same stall; a tool observation clears it", async () => {
    const first = await think({ on: true, forced: [{ type: "content_complete", content: "", stopReason: "end_turn" }, { type: "usage", usage }] });
    expect(records(first.state)).toHaveLength(1);
    const again = await think({ on: true, state: { steps: first.state.steps } });
    expect(again.requests).toHaveLength(1);
    const cleared = await think({
      on: true,
      state: { steps: [...first.state.steps, makeStep("observation", "result", { toolUsed: "http-get" })] },
    });
    expect(cleared.requests).toHaveLength(2);
  }, 15000);

  it("does not fire when off, when no domain tool is callable, or when nothing is outstanding", async () => {
    expect((await think({ on: false })).requests).toHaveLength(1);
    expect((await think({ on: true, input: { availableToolSchemas: [] } })).requests).toHaveLength(1);
    expect((await think({ on: true, input: { requiredTools: [] } })).requests).toHaveLength(1);
  }, 15000);

  it("does not fire on an accepted deliverable (required tool already satisfied)", async () => {
    const { requests } = await think({
      on: true,
      state: {
        evidence: { successfulCounts: { "web-search": 1 }, attemptedCounts: { "web-search": 1 }, permanentlyFailed: [], substantive: true, seeded: false },
        toolsUsed: new Set(["web-search"]),
      },
    });
    expect(requests).toHaveLength(1);
  }, 15000);

  it("off: the request is identical to the on-path first request (no toolChoice, no tail)", async () => {
    const off = await think({ on: false });
    const on = await think({ on: true });
    expect(off.requests[0]).toEqual(on.requests[0]!);
    expect("toolChoice" in off.requests[0]!).toBe(false);
  }, 15000);
});

const failedSearch = () => [
  makeStep("action", `web-search({"query":"x"})`, { toolCall: { id: "c1", name: "web-search", arguments: { query: "x" } } }),
  makeStep("observation", "error: upstream timeout", {
    toolCallId: "c1",
    observationResult: makeObservationResult("web-search", false, "error: upstream timeout"),
  }),
];
const stepArm = (on: ActOrAnswerSetting, extra: Partial<KernelInput> = {}): Arm => ({
  on,
  input: { requiredTools: [], deliveryScope: "step", stepTools: ["web-search"], ...extra },
});

describe("act-or-answer proactive — the first request of a turn that must act is forced", () => {
  it("forces the first request over the callable set: one call, no prose turn spent", async () => {
    const { state, requests, fired } = await think({ on: "proactive" });
    expect(requests).toHaveLength(1);
    const [forced] = requests;
    expect(forced!.toolChoice).toBe("required");
    const off = await think({ on: false });
    const offNames = (off.requests[0]!.tools ?? []).map((t) => t.name);
    expect((forced!.tools ?? []).map((t) => t.name).filter((n) => n !== "final-answer")).toEqual(offNames);
    expect(lastText(forced!)).toContain("[Harness] Work is still outstanding (web-search)");
    expect(state.status).toBe("acting");
    expect(state.meta.pendingNativeToolCalls?.map((c) => c.name)).toEqual(["web-search"]);
    // One LLM call billed, not two.
    expect(state.tokens).toBe(15);
    expect(records(state)).toHaveLength(1);
    expect(records(state)[0]?.metadata?.intervention?.whatChanged).toContain("first request sent with a required tool call");
    expect(fired).toHaveLength(1);
    expect(fired[0]?.metadata).toMatchObject({ mode: "proactive", result: "called", tools: ["web-search"] });
  }, 15000);

  it("the proactive request is the retry mode's forced request, byte for byte", async () => {
    const proactive = await think({ on: "proactive" });
    const retry = await think({ on: true });
    expect(retry.requests).toHaveLength(2);
    expect(proactive.requests[0]).toEqual(retry.requests[1]!);
  }, 15000);

  it("retry mode and off are unchanged: retry's first request is off's request; retry events carry no mode", async () => {
    const off = await think({ on: false });
    const retry = await think({ on: true });
    expect(off.requests).toHaveLength(1);
    expect(retry.requests[0]).toEqual(off.requests[0]!);
    expect("toolChoice" in off.requests[0]!).toBe(false);
    expect(retry.fired).toHaveLength(1);
    expect(retry.fired[0]?.metadata && "mode" in retry.fired[0].metadata).toBe(false);
    expect(off.fired).toHaveLength(0);
  }, 15000);

  it("a plan step with a declared tool not yet called is forced (proactive) and retried (retry mode)", async () => {
    const proactive = await think(stepArm("proactive"));
    expect(proactive.requests).toHaveLength(1);
    expect(proactive.requests[0]!.toolChoice).toBe("required");
    expect(lastText(proactive.requests[0]!)).toContain("outstanding (step tool (web-search))");
    expect(proactive.state.meta.pendingNativeToolCalls?.map((c) => c.name)).toEqual(["web-search"]);
    const retry = await think(stepArm(true));
    expect(retry.requests).toHaveLength(2);
    expect(retry.requests[1]!.toolChoice).toBe("required");
  }, 15000);

  it("a plan step whose declared tool already ran, or a step without declared tools, is not forced", async () => {
    const ran = await think({ ...stepArm("proactive"), state: { toolsUsed: new Set(["web-search"]) } });
    expect(ran.requests).toHaveLength(1);
    expect(ran.requests[0]!.toolChoice).toBeUndefined();
    const undeclared = await think({ on: "proactive", input: { requiredTools: [], deliveryScope: "step" } });
    expect(undeclared.requests).toHaveLength(1);
    expect(undeclared.requests[0]!.toolChoice).toBeUndefined();
  }, 15000);

  it("not forced right after a failed tool call; the turn runs unforced and the retry is its fallback", async () => {
    const { requests, fired } = await think({ on: "proactive", state: { steps: failedSearch() } });
    expect(requests).toHaveLength(2);
    expect(requests[0]!.toolChoice).toBeUndefined();
    expect(requests[1]!.toolChoice).toBe("required");
    expect(fired.map((f) => f.metadata?.mode)).toEqual(["retry"]);
  }, 15000);

  it("not forced when nothing is outstanding", async () => {
    const { requests, fired } = await think({ on: "proactive", input: { requiredTools: [] } });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.toolChoice).toBeUndefined();
    expect(fired).toHaveLength(0);
  }, 15000);

  it("not forced on Anthropic with a thinking-capable model (forcing would drop thinking)", async () => {
    const { requests } = await think({ on: "proactive", profile: { ...CONTEXT_PROFILES.mid, thinkingModel: true } });
    expect(requests[0]!.toolChoice).toBeUndefined();
    // Another provider with the same capability forces.
    const openai = await think({ on: "proactive", input: { providerName: "openai" }, profile: { ...CONTEXT_PROFILES.mid, thinkingModel: true } });
    expect(openai.requests).toHaveLength(1);
    expect(openai.requests[0]!.toolChoice).toBe("required");
  }, 15000);

  it("forced reply with no call: the retry runs as the fallback, then the stall latches", async () => {
    const noCall: readonly StreamEvent[] = [
      { type: "content_complete", content: "still no call", stopReason: "end_turn" },
      { type: "usage", usage },
    ];
    const first = await think({ on: "proactive", forced: noCall });
    expect(first.requests.map((r) => r.toolChoice)).toEqual(["required", "required"]);
    expect(first.fired.map((f) => [f.metadata?.mode, f.metadata?.result])).toEqual([["proactive", "no-call"], ["retry", "no-call"]]);
    expect(records(first.state)).toHaveLength(2);
    const next = await think({ on: "proactive", state: { steps: first.state.steps } });
    expect(next.requests).toHaveLength(1);
    expect(next.requests[0]!.toolChoice).toBeUndefined();
  }, 15000);

  it("a forced request the provider rejects is re-sent unforced: forcing never causes an llm_error", async () => {
    const { state, requests, fired } = await think({ on: "proactive", forced: "fail" });
    expect(requests[0]!.toolChoice).toBe("required");
    expect(requests[1]!.toolChoice).toBeUndefined();
    expect(fired[0]?.metadata).toMatchObject({ mode: "proactive", result: "no-call", forcedFailed: true });
    expect(state.meta.terminatedBy).not.toBe("llm_error");
    expect(state.status).not.toBe("failed");
  }, 15000);
});

describe("act-or-answer tally — counted every turn, in every mode", () => {
  const noCall: readonly StreamEvent[] = [
    { type: "content_complete", content: "still no call", stopReason: "end_turn" },
    { type: "usage", usage },
  ];
  const okObservation = (id: string, success: boolean) =>
    makeStep("observation", success ? "ok" : "error", { toolCallId: id, observationResult: makeObservationResult("web-search", success, success ? "ok" : "error") });

  it("off: a stall is counted, nothing is forced, the request is unchanged", async () => {
    const { state, requests } = await think({ on: false });
    expect(requests).toHaveLength(1);
    expect(actOrAnswerTally(state)).toEqual({ noCallStalls: 1, unforcedToolWorkTurns: 1, forced: 0, forcedCalled: 0, forcedCallSucceeded: 0 });
  }, 15000);

  it("an unforced turn that calls a tool while work is outstanding is an opportunity, not a stall", async () => {
    const { state, requests } = await think({ on: false, unforced: callEvents("web-search", { query: "q" }) });
    expect(requests).toHaveLength(1);
    expect(actOrAnswerTally(state)).toEqual({ noCallStalls: 0, unforcedToolWorkTurns: 1, forced: 0, forcedCalled: 0, forcedCallSucceeded: 0 });
    // Retry mode, same reply: no retry, same count.
    expect(actOrAnswerTally((await think({ on: true, unforced: callEvents("web-search", { query: "q" }) })).state).unforcedToolWorkTurns).toBe(1);
  }, 15000);

  it("an unforced turn with no tool work outstanding is not an opportunity", async () => {
    const { state } = await think({ on: false, input: { requiredTools: [] }, unforced: callEvents("web-search", { query: "q" }) });
    expect(state.meta.actOrAnswerTally).toBeUndefined();
  }, 15000);

  it("off with nothing outstanding: no stall, no tally written", async () => {
    const { state } = await think({ on: false, input: { requiredTools: [] } });
    expect(state.meta.actOrAnswerTally).toBeUndefined();
  }, 15000);

  it("retry: stall + forced + called; success is read from the forced call's observation", async () => {
    const { state } = await think({ on: true });
    expect(state.meta.actOrAnswerTally?.forcedCallIds).toEqual([["forced-1"]]);
    expect(actOrAnswerTally(state)).toEqual({ noCallStalls: 1, unforcedToolWorkTurns: 1, forced: 1, forcedCalled: 1, forcedCallSucceeded: 0 });
    expect(actOrAnswerTally({ ...state, steps: [...state.steps, okObservation("forced-1", true)] }).forcedCallSucceeded).toBe(1);
    expect(actOrAnswerTally({ ...state, steps: [...state.steps, okObservation("forced-1", false)] }).forcedCallSucceeded).toBe(0);
  }, 15000);

  it("the forced call's act-phase observation carries its call id (the success link)", async () => {
    const { state } = await think({ on: true });
    const acted = await Effect.runPromise(
      handleActing(state, context({ on: true })).pipe(Effect.provide(scriptedLLM([], proseEvents))),
    );
    expect(acted.steps.some((s) => s.type === "observation" && s.metadata?.toolCallId === "forced-1")).toBe(true);
  }, 15000);

  it("retry with a no-call forced reply: stall + forced, not called", async () => {
    const { state } = await think({ on: true, forced: noCall });
    expect(actOrAnswerTally(state)).toEqual({ noCallStalls: 1, unforcedToolWorkTurns: 1, forced: 1, forcedCalled: 0, forcedCallSucceeded: 0 });
  }, 15000);

  it("a forced final-answer reply is forced but not a domain call", async () => {
    const { state } = await think({ on: true, forced: callEvents("final-answer", { output: "x", format: "text", summary: "s" }) });
    expect(actOrAnswerTally(state)).toMatchObject({ forced: 1, forcedCalled: 0 });
  }, 15000);

  it("proactive called: forced + called; a forced turn is neither a stall nor an unforced opportunity", async () => {
    const { state } = await think({ on: "proactive" });
    expect(actOrAnswerTally(state)).toEqual({ noCallStalls: 0, unforcedToolWorkTurns: 0, forced: 1, forcedCalled: 1, forcedCallSucceeded: 0 });
  }, 15000);

  it("proactive no-call: two forced requests (first + fallback retry); no unforced reply, so no stall", async () => {
    const { state } = await think({ on: "proactive", forced: noCall });
    expect(actOrAnswerTally(state)).toEqual({ noCallStalls: 0, unforcedToolWorkTurns: 0, forced: 2, forcedCalled: 0, forcedCallSucceeded: 0 });
  }, 15000);

  it("proactive not forced (after a failed call): the unforced reply measures the stall rate", async () => {
    const { state } = await think({ on: "proactive", state: { steps: failedSearch() } });
    expect(actOrAnswerTally(state)).toMatchObject({ noCallStalls: 1, unforcedToolWorkTurns: 1, forced: 1 });
  }, 15000);

  it("a forced request the provider rejects still counts as forced; its unforced re-send is an opportunity", async () => {
    const { state } = await think({ on: "proactive", forced: "fail" });
    // Forced twice: the rejected first request, then the retry after the unforced re-send's prose.
    expect(actOrAnswerTally(state)).toMatchObject({ forced: 2, noCallStalls: 1, unforcedToolWorkTurns: 1 });
  }, 15000);

  it("an unresolved auto never forces: it acts as off (stall counted, one request)", async () => {
    const { state, requests, fired } = await think({ on: "auto" });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.toolChoice).toBeUndefined();
    expect(fired).toHaveLength(0);
    expect(actOrAnswerTally(state)).toMatchObject({ noCallStalls: 1, unforcedToolWorkTurns: 1, forced: 0 });
    expect(effectiveActOrAnswerMode({ actOrAnswer: "auto" })).toBe(false);
    expect(effectiveActOrAnswerMode({ actOrAnswer: "proactive" })).toBe("proactive");
  }, 15000);

  it("the kernel terminal relay carries the summary on metadata.extensions.actOrAnswer", async () => {
    const { state } = await think({ on: true });
    const meta = kernelTerminalMetadata(state, []);
    expect((meta.extensions as Record<string, unknown>).actOrAnswer).toEqual(actOrAnswerTally(state));
    expect((meta.extensions as Record<string, unknown>).signalTally).toBeDefined();
  }, 15000);

  it("isNoCallStall: the trigger minus the switch, latch, pressure and posture", () => {
    const facts = { nativeFC: true, toolsWithheld: false, disposition: "prose" as const, stopReason: "end_turn", domainToolsOnWire: 1, outstanding: ["web-search"] };
    expect(isNoCallStall(facts)).toBe(true);
    expect(isNoCallStall({ ...facts, outstanding: [] })).toBe(false);
    expect(isNoCallStall({ ...facts, stopReason: "max_tokens" })).toBe(false);
    expect(isNoCallStall({ ...facts, domainToolsOnWire: 0 })).toBe(false);
    expect(isNoCallStall({ ...facts, nativeFC: false })).toBe(false);
  });
});

describe("act-or-answer — pure rules", () => {
  const trigger: ActOrAnswerTrigger = {
    enabled: true,
    nativeFC: true,
    toolsWithheld: false,
    disposition: "prose",
    stopReason: "end_turn",
    domainToolsOnWire: 1,
    outstanding: ["web-search"],
    latched: false,
    pressureCritical: false,
    planPosture: false,
  };

  it("fires only when every condition holds", () => {
    expect(shouldActOrAnswer(trigger)).toBe(true);
    expect(shouldActOrAnswer({ ...trigger, nativeFC: false })).toBe(false);
    expect(shouldActOrAnswer({ ...trigger, toolsWithheld: true })).toBe(false);
    expect(shouldActOrAnswer({ ...trigger, disposition: "unresolved" })).toBe(false);
    expect(shouldActOrAnswer({ ...trigger, stopReason: "max_tokens" })).toBe(false);
    expect(shouldActOrAnswer({ ...trigger, pressureCritical: true })).toBe(false);
    expect(shouldActOrAnswer({ ...trigger, planPosture: true })).toBe(false);
  });

  it("outstanding work: an unmet ToolCalled delivery condition counts; OutputContains does not", () => {
    const state = startState({ on: true });
    const input = context({ on: true, input: { requiredTools: [] } }).input;
    expect(outstandingToolWork(state, input)).toEqual([]);
    const withCondition = { ...state, meta: { ...state.meta, postConditions: [toolCalled("http-get"), { kind: "OutputContains" as const, pattern: "42" }] } };
    expect(outstandingToolWork(withCondition, input)).toEqual(["http-get"]);
  });

  it("proactive trigger: fires only in proactive mode when every condition holds", () => {
    const t: ProactiveTrigger = {
      mode: "proactive",
      nativeFC: true,
      toolsWithheld: false,
      domainToolsOnWire: 1,
      outstanding: ["web-search"],
      latched: false,
      pressureCritical: false,
      planPosture: false,
      afterFailedCall: false,
      dropsThinking: false,
    };
    expect(shouldForceFirstRequest(t)).toBe(true);
    expect(shouldForceFirstRequest({ ...t, mode: true })).toBe(false);
    expect(shouldForceFirstRequest({ ...t, mode: false })).toBe(false);
    expect(shouldForceFirstRequest({ ...t, outstanding: [] })).toBe(false);
    expect(shouldForceFirstRequest({ ...t, latched: true })).toBe(false);
    expect(shouldForceFirstRequest({ ...t, planPosture: true })).toBe(false);
    expect(shouldForceFirstRequest({ ...t, afterFailedCall: true })).toBe(false);
    expect(shouldForceFirstRequest({ ...t, dropsThinking: true })).toBe(false);
    expect(shouldForceFirstRequest({ ...t, domainToolsOnWire: 0 })).toBe(false);
  });

  it("forcing drops thinking only on Anthropic thinking-capable models; Ollama forces", () => {
    expect(forcingDropsThinking("anthropic", { thinkingModel: true })).toBe(true);
    expect(forcingDropsThinking("anthropic", {})).toBe(false);
    expect(forcingDropsThinking("ollama", { thinkingModel: true })).toBe(false);
  });

  it("last tool call failed: a failed observation before any thought; a later thought answers it", () => {
    expect(lastToolCallFailed(failedSearch())).toBe(true);
    expect(lastToolCallFailed([...failedSearch(), makeStep("thought", "try another way")])).toBe(false);
    expect(lastToolCallFailed([makeStep("observation", "ok", { observationResult: makeObservationResult("web-search", true, "ok") })])).toBe(false);
    expect(lastToolCallFailed([])).toBe(false);
  });

  it("step tools: outstanding until one of them is called; a missing required step tool is listed once", () => {
    const state = startState({ on: true });
    const input = context(stepArm(true, { stepTools: ["web-search", "http-get"] })).input;
    expect(outstandingToolWork(state, input)).toEqual(["step tool (web-search | http-get)"]);
    expect(outstandingToolWork({ ...state, toolsUsed: new Set(["http-get"]) }, input)).toEqual([]);
    const required = context(stepArm(true, { requiredTools: ["web-search"] })).input;
    expect(outstandingToolWork(state, required)).toEqual(["web-search"]);
  });

  it("latch reads back to the last observation", () => {
    const record = makeStep("harness_signal", "r", {
      intervention: { actor: ACT_OR_ANSWER_ACTOR, authorityClass: "deterministic", evidence: "e", whatChanged: "w", iter: 1 },
    });
    expect(actOrAnswerLatched([record, makeStep("thought", "t")])).toBe(true);
    expect(actOrAnswerLatched([record, makeStep("observation", "o")])).toBe(false);
    expect(actOrAnswerLatched([makeStep("thought", "t")])).toBe(false);
  });
});
