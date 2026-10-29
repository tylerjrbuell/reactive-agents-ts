// Run: bun test packages/reasoning/src/kernel/capabilities/reason/think-environment-update.test.ts --timeout 15000
//
// Wire-and-pin: RunEnvelope.rails.environmentUpdate reaches the real
// ProviderRequest exactly once (Guidance: block), is observable via the signal
// ledger, and an absent notice leaves the request byte-identical.
import { describe, it, expect } from "bun:test";
import { Effect, Layer, Option, Stream } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";
import type { StreamEvent } from "@reactive-agents/llm-provider";
import { NativeFCDriver } from "@reactive-agents/tools";
import { handleThinking } from "./think.js";
import { initialKernelState, noopHooks, type KernelContext, type KernelInput, type KernelState } from "../../state/kernel-state.js";
import { CONTEXT_PROFILES } from "../../../context/context-profile.js";
import { buildRunEnvelope, mergeRunEnvelopeIntoKernelInput } from "../../envelope/run-envelope.js";
import { ENVIRONMENT_UPDATE_SIGNAL_KIND } from "../reflect/environment-update.js";

const events: readonly StreamEvent[] = [
  { type: "text_delta", text: "Considering." },
  { type: "content_complete", content: "Considering." },
  { type: "usage", usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12, estimatedCost: 0 } },
];

const makeLLM = (sink: { req?: unknown }) =>
  Layer.succeed(LLMService, {
    complete: () => Effect.succeed({ content: "ok", stopReason: "end_turn", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, estimatedCost: 0 }, model: "m" }) as never,
    stream: (req: unknown) => { sink.req = req; return Effect.succeed(Stream.fromIterable(events) as never); },
    completeStructured: () => Effect.succeed({ ok: true }) as never,
    embed: () => Effect.succeed([]),
    countTokens: () => Effect.succeed(0),
    getModelConfig: () => Effect.succeed({} as never),
    getStructuredOutputCapabilities: () => Effect.succeed({} as never),
    capabilities: () => Effect.succeed({} as never),
  } as never);

const ctx = (input: KernelInput): KernelContext => ({
  input,
  profile: CONTEXT_PROFILES.local,
  compression: { budget: 800, previewItems: 5, autoStore: true, codeTransform: true },
  toolService: Option.none(),
  hooks: noopHooks,
  toolCallingDriver: new NativeFCDriver(),
  memoryService: Option.none(),
});

const state0 = (): KernelState => ({
  ...initialKernelState({ strategy: "reactive", kernelType: "reactive", maxIterations: 8 }),
  iteration: 1,
  messages: [{ role: "user", content: "Do the work." }],
});

const think = async (input: KernelInput, state: KernelState) => {
  const sink: { req?: unknown } = {};
  const out = await Effect.runPromise(handleThinking(state, ctx(input)).pipe(Effect.provide(makeLLM(sink))));
  return { request: JSON.stringify(sink.req), out };
};

const NOTICE = "Environment update since your last turn:\n- Tools: +a, -b.";
const base: KernelInput = { task: "Do the work." };
const viaEnvelope = (env: Parameters<typeof buildRunEnvelope>[0]): KernelInput =>
  mergeRunEnvelopeIntoKernelInput(base, buildRunEnvelope(env));
const count = (s: string, needle: string) => s.split(needle).length - 1;

describe("think — environmentUpdate from the RunEnvelope", () => {
  it("renders in the request exactly once, records a rendered signal, absent on the next think", async () => {
    const input = viaEnvelope({ environmentUpdate: NOTICE });
    expect(input.environmentUpdate).toBe(NOTICE);
    const first = await think(input, state0());
    expect(first.request).toContain("Guidance:");
    expect(count(first.request, "Tools: +a, -b.")).toBe(1);
    const sigs = first.out.signalLedger?.filter((s) => s.signalKind === ENVIRONMENT_UPDATE_SIGNAL_KIND) ?? [];
    expect(sigs.length).toBe(1);
    expect(sigs[0]?.state).toBe("rendered");
    // Same pass, later iteration (state carries the ledger): not repeated.
    const second = await think(input, { ...state0(), iteration: 2, signalLedger: first.out.signalLedger });
    expect(second.request).not.toContain("Tools: +a, -b.");
    expect(second.out.signalLedger?.filter((s) => s.signalKind === ENVIRONMENT_UPDATE_SIGNAL_KIND).length).toBe(1);
  });

  it("pendingGuidance.environmentUpdate renders too (same one-shot path)", async () => {
    const r = await think(base, { ...state0(), pendingGuidance: { requiredToolsPending: [], loopDetected: false, environmentUpdate: NOTICE } });
    expect(count(r.request, "Tools: +a, -b.")).toBe(1);
  });

  it("absent notice: request byte-identical to baseline, ledger untouched", async () => {
    const baseline = await think(base, state0());
    const withEmptyEnvelope = await think(viaEnvelope({}), state0());
    expect(withEmptyEnvelope.request).toBe(baseline.request);
    expect(withEmptyEnvelope.out.signalLedger ?? []).toEqual(baseline.out.signalLedger ?? []);
    expect(baseline.request).not.toContain("Environment update");
    expect("environmentUpdate" in viaEnvelope({})).toBe(false);
  });
});
