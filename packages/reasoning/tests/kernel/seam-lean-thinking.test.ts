// Run: bun test packages/reasoning/tests/kernel/seam-lean-thinking.test.ts --timeout 15000
//
// Seam pin for kernel/capabilities/reason/lean-thinking.ts (harness switch
// `leanThinking`, default OFF). A tool-selection turn on a thinking-capable
// Ollama model is requested with `thinking: false`; every other turn is
// byte-identical, and the thinking-runaway recovery still fires. Zero tokens:
// a scripted LLM captures the request.

import { describe, expect, it } from "bun:test";
import { Effect, Layer, Option, Stream } from "effect";
import {
  LLMService,
  type CompletionRequest,
  type CompletionResponse,
  type StreamEvent,
  type StructuredCompletionRequest,
} from "@reactive-agents/llm-provider";
import { EventBus, EventBusLive } from "@reactive-agents/core";
import { NativeFCDriver, NativeFCStrategy } from "@reactive-agents/tools";
import { handleThinking } from "../../src/kernel/capabilities/reason/think.js";
import {
  LEAN_THINKING_GUARD,
  shouldThinkLean,
  type LeanThinkingFacts,
} from "../../src/kernel/capabilities/reason/lean-thinking.js";
import { THINKING_RUNAWAY_MESSAGE } from "../../src/kernel/capabilities/reason/thinking-runaway.js";
import {
  initialKernelState,
  noopHooks,
  type KernelContext,
  type KernelInput,
  type KernelState,
} from "../../src/kernel/state/kernel-state.js";
import { CONTEXT_PROFILES } from "../../src/context/context-profile.js";
import { resolveHarnessConfig } from "../../src/harness-config.js";
import { makeStep } from "../../src/kernel/capabilities/sense/step-utils.js";
import { makeObservationResult } from "../../src/kernel/utils/observation-helpers.js";
import type { ToolSchema } from "../../src/kernel/capabilities/attend/tool-formatting.js";

const SEARCH: ToolSchema = {
  name: "web-search",
  description: "Search the web for a query.",
  parameters: [{ name: "query", type: "string", required: true, description: "the query" }],
};
const usage = { inputTokens: 10, outputTokens: 5, totalTokens: 15, estimatedCost: 0 };
const proseEvents: readonly StreamEvent[] = [
  { type: "text_delta", text: "I would search for it." },
  { type: "content_complete", content: "I would search for it.", stopReason: "end_turn" },
  { type: "usage", usage },
];
/** A thinking-only turn cut off at the budget: the runaway shape. */
const runawayEvents: readonly StreamEvent[] = [
  { type: "thinking_delta", thinking: "hmm let me think about this at length" },
  { type: "content_complete", content: "", stopReason: "max_tokens", thinking: "hmm let me think about this at length" },
  { type: "usage", usage },
];

function scriptedLLM(captured: CompletionRequest[], events: readonly StreamEvent[]) {
  return Layer.succeed(
    LLMService,
    LLMService.of({
      complete: (_r: CompletionRequest) =>
        Effect.succeed<CompletionResponse>({ content: "", stopReason: "end_turn", usage, model: "test" }),
      stream: (request: CompletionRequest) => {
        captured.push(request);
        return Effect.succeed(Stream.fromIterable(events));
      },
      completeStructured: <A>(_r: StructuredCompletionRequest<A>) => Effect.die("unused"),
      embed: (t: readonly string[]) => Effect.succeed(t.map(() => [0])),
      countTokens: (m: readonly unknown[]) => Effect.succeed(m.length),
      getModelConfig: () => Effect.succeed({ provider: "ollama", model: "test-model" }),
      getStructuredOutputCapabilities: () =>
        Effect.succeed({ nativeJsonMode: false, jsonSchemaEnforcement: false, prefillSupport: false, grammarConstraints: false }),
      capabilities: () =>
        Effect.succeed({ supportsToolCalling: true, supportsStreaming: true, supportsSystemPrompt: true, supportsLogprobs: false, supportsNativeStreaming: true, supportsPromptCaching: false }),
    }),
  );
}

interface Arm {
  readonly lean: boolean;
  readonly provider?: string;
  readonly thinkingModel?: boolean;
  readonly input?: Partial<KernelInput>;
  readonly state?: Partial<KernelState>;
  readonly events?: readonly StreamEvent[];
}

function context(arm: Arm): KernelContext {
  return {
    input: {
      task: "Find the current value with web-search and report it.",
      availableToolSchemas: [SEARCH],
      requiredTools: ["web-search"],
      providerName: arm.provider ?? "ollama",
      modelId: "test-model",
      toolCallResolver: new NativeFCStrategy(),
      harness: resolveHarnessConfig({ lazyDisclosure: false, leanThinking: arm.lean }),
      ...arm.input,
    },
    profile: { ...CONTEXT_PROFILES.mid, ...(arm.thinkingModel === false ? {} : { thinkingModel: true }) },
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

async function think(arm: Arm) {
  const requests: CompletionRequest[] = [];
  const fired: { outcome: string; metadata?: Record<string, unknown> }[] = [];
  const program = Effect.gen(function* () {
    const bus = yield* EventBus;
    yield* bus.subscribe((ev) =>
      ev._tag === "GuardFiredEmitted" && ev.guard === LEAN_THINKING_GUARD
        ? Effect.sync(() => { fired.push({ outcome: ev.outcome, metadata: ev.metadata }); })
        : Effect.void,
    );
    return yield* handleThinking(startState(arm), context(arm));
  });
  const state = await Effect.runPromise(
    program.pipe(Effect.provide(Layer.merge(scriptedLLM(requests, arm.events ?? proseEvents), EventBusLive))),
  );
  return { state, requests, fired };
}

describe("lean thinking — a tool-selection turn on a thinking model asks for thinking off", () => {
  it("on: the request carries thinking:false and one lean-thinking record", async () => {
    const { requests, fired } = await think({ lean: true });
    expect(requests[0]!.thinking).toBe(false);
    expect(fired).toHaveLength(1);
    expect(fired[0]!.metadata).toMatchObject({ thinking: false, outstanding: ["web-search"] });
  }, 15000);

  it("off (default): the request has no thinking override and is otherwise identical", async () => {
    const off = await think({ lean: false });
    const on = await think({ lean: true });
    expect("thinking" in off.requests[0]!).toBe(false);
    expect(off.fired).toHaveLength(0);
    const { thinking: _t, ...onRest } = on.requests[0]!;
    expect(onRest).toEqual(off.requests[0]!);
  }, 15000);

  it("does not fire for a non-thinking model, a paid provider, or nothing outstanding", async () => {
    expect("thinking" in (await think({ lean: true, thinkingModel: false })).requests[0]!).toBe(false);
    expect("thinking" in (await think({ lean: true, provider: "anthropic" })).requests[0]!).toBe(false);
    expect("thinking" in (await think({ lean: true, input: { requiredTools: [] } })).requests[0]!).toBe(false);
  }, 15000);

  it("does not fire right after a failed tool call: the model may need to change approach", async () => {
    const failed = [
      makeStep("action", `web-search({"query":"x"})`, { toolCall: { id: "c1", name: "web-search", arguments: { query: "x" } } }),
      makeStep("observation", "error: upstream timeout", {
        toolCallId: "c1",
        observationResult: makeObservationResult("web-search", false, "error: upstream timeout"),
      }),
    ];
    const { requests, fired } = await think({ lean: true, state: { steps: failed } });
    expect("thinking" in requests[0]!).toBe(false);
    expect(fired).toHaveLength(0);
  }, 15000);

  it("the existing thinking-runaway recovery still fires with the switch on", async () => {
    const { state, requests } = await think({ lean: true, events: runawayEvents });
    expect(requests[0]!.thinking).toBe(false);
    expect(state.maxOutputTokensRecoveryCount).toBe(1);
    expect(state.messages[state.messages.length - 1]?.content).toBe(THINKING_RUNAWAY_MESSAGE);
  }, 15000);

  it("the runaway retry still sends thinking:false when the switch is off", async () => {
    const { requests } = await think({
      lean: false,
      state: { messages: [{ role: "user", content: "t" }, { role: "user", content: THINKING_RUNAWAY_MESSAGE }] },
    });
    expect(requests[0]!.thinking).toBe(false);
  }, 15000);
});

describe("lean thinking — pure rule", () => {
  const holds: LeanThinkingFacts = {
    enabled: true,
    thinkingModel: true,
    providerName: "ollama",
    nativeFC: true,
    toolsWithheld: false,
    domainToolsOnWire: 1,
    outstanding: ["web-search"],
    afterFailedCall: false,
  };
  it("fires only when every condition holds", () => {
    expect(shouldThinkLean(holds)).toBe(true);
    expect(shouldThinkLean({ ...holds, enabled: false })).toBe(false);
    expect(shouldThinkLean({ ...holds, thinkingModel: false })).toBe(false);
    expect(shouldThinkLean({ ...holds, providerName: "anthropic" })).toBe(false);
    expect(shouldThinkLean({ ...holds, nativeFC: false })).toBe(false);
    expect(shouldThinkLean({ ...holds, toolsWithheld: true })).toBe(false);
    expect(shouldThinkLean({ ...holds, domainToolsOnWire: 0 })).toBe(false);
    expect(shouldThinkLean({ ...holds, outstanding: [] })).toBe(false);
    expect(shouldThinkLean({ ...holds, afterFailedCall: true })).toBe(false);
  });

  it("resolves off by default and on when configured", () => {
    expect(resolveHarnessConfig().leanThinking).toBeUndefined();
    expect(resolveHarnessConfig({ leanThinking: true }).leanThinking).toBe(true);
    expect(resolveHarnessConfig({ leanThinking: false }).leanThinking).toBeUndefined();
  });
});
