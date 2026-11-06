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
  LLMService,
  type CompletionRequest,
  type CompletionResponse,
  type StreamEvent,
  type StructuredCompletionRequest,
} from "@reactive-agents/llm-provider";
import { NativeFCDriver, NativeFCStrategy } from "@reactive-agents/tools";
import { handleThinking } from "../../../../src/kernel/capabilities/reason/think.js";
import { handleActing } from "../../../../src/kernel/capabilities/act/act.js";
import {
  ACT_OR_ANSWER_ACTOR,
  actOrAnswerLatched,
  outstandingToolWork,
  shouldActOrAnswer,
  type ActOrAnswerTrigger,
} from "../../../../src/kernel/capabilities/reason/act-or-answer.js";
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

/** Scripted LLM: prose for an unforced request; `forced` events when toolChoice is "required". */
function scriptedLLM(captured: CompletionRequest[], forced: readonly StreamEvent[]) {
  return Layer.succeed(
    LLMService,
    LLMService.of({
      complete: (_r: CompletionRequest) =>
        Effect.succeed<CompletionResponse>({ content: "", stopReason: "end_turn", usage, model: "test" }),
      stream: (request: CompletionRequest) => {
        captured.push(request);
        return Effect.succeed(Stream.fromIterable(request.toolChoice === "required" ? forced : proseEvents));
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
  readonly on: boolean;
  readonly input?: Partial<KernelInput>;
  readonly state?: Partial<KernelState>;
  readonly forced?: readonly StreamEvent[];
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
    profile: CONTEXT_PROFILES.mid,
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

async function think(arm: Arm): Promise<{ state: KernelState; requests: CompletionRequest[] }> {
  const requests: CompletionRequest[] = [];
  const state = await Effect.runPromise(
    handleThinking(startState(arm), context(arm)).pipe(
      Effect.provide(scriptedLLM(requests, arm.forced ?? callEvents("web-search", { query: "current value" }))),
    ),
  );
  return { state, requests };
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

  it("latch reads back to the last observation", () => {
    const record = makeStep("harness_signal", "r", {
      intervention: { actor: ACT_OR_ANSWER_ACTOR, authorityClass: "deterministic", evidence: "e", whatChanged: "w", iter: 1 },
    });
    expect(actOrAnswerLatched([record, makeStep("thought", "t")])).toBe(true);
    expect(actOrAnswerLatched([record, makeStep("observation", "o")])).toBe(false);
    expect(actOrAnswerLatched([makeStep("thought", "t")])).toBe(false);
  });
});
