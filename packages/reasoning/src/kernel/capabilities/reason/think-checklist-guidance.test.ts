// Run: bun test packages/reasoning/src/kernel/capabilities/reason/think-checklist-guidance.test.ts --timeout 15000
//
// Wire-and-pin (ruling V5): the opt-in todo reminder + M1 line reach the real
// ProviderRequest built by handleThinking, and with the options OFF (or `todo`
// absent) the request bytes are IDENTICAL to the baseline.
import { describe, it, expect } from "bun:test";
import { Effect, Layer, Option, Stream } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";
import type { StreamEvent } from "@reactive-agents/llm-provider";
import { NativeFCDriver } from "@reactive-agents/tools";
import { handleThinking } from "./think.js";
import { initialKernelState, noopHooks, type KernelContext, type KernelInput, type KernelState } from "../../state/kernel-state.js";
import { appendEntries } from "../../ledger/run-ledger.js";
import { CONTEXT_PROFILES } from "../../../context/context-profile.js";
import type { ToolSchema } from "../attend/tool-formatting.js";
import { CHECKLIST_REMINDER_SIGNAL_KIND, CHECKLIST_SYSTEM_LINE } from "../reflect/checklist-reminder.js";

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

const fileWrite: ToolSchema = { name: "file-write", description: "Write a file.", parameters: [{ name: "path", type: "string", required: true }] };
const todo: ToolSchema = { name: "todo", description: "Keep a checklist.", parameters: [{ name: "action", type: "string", required: true }] };

const ctx = (input: KernelInput, system: { s: string }): KernelContext => ({
  input,
  profile: CONTEXT_PROFILES.local,
  compression: { budget: 800, previewItems: 5, autoStore: true, codeTransform: true },
  toolService: Option.none(),
  hooks: { ...noopHooks, onThought: (_s: KernelState, _t: string, p?: { system: string }) => { system.s = p?.system ?? ""; return Effect.void; } },
  toolCallingDriver: new NativeFCDriver(),
  memoryService: Option.none(),
});

/** Iteration 3; rounds 2+3 (labels current-1, current) each ran a non-todo tool; one open row; no status change. */
const staleState = (): KernelState => ({
  ...initialKernelState({ strategy: "reactive", kernelType: "reactive", maxIterations: 8 }),
  iteration: 3,
  messages: [{ role: "user", content: "Do the work." }],
  ledger: appendEntries(undefined, [
    { kind: "checklist-item", iteration: 0, change: { op: "add", items: [{ id: "1", title: "gather data" }] } },
    { kind: "tool-invocation", iteration: 2, toolName: "file-write" },
    { kind: "tool-invocation", iteration: 3, toolName: "file-write" },
  ]),
});

const run = async (input: Partial<KernelInput>, state: KernelState = staleState()) => {
  const sink: { req?: unknown } = {};
  const system = { s: "" };
  const out = await Effect.runPromise(
    handleThinking(state, ctx({ task: "Do the work.", ...input }, system)).pipe(Effect.provide(makeLLM(sink))),
  );
  return { request: JSON.stringify(sink.req), system: system.s, out };
};

const withTodo = { availableToolSchemas: [fileWrite, todo] };
const REMINDER = "Todo: 1 open ([1] gather data)";

describe("think — opt-in todo guidance reaches the ProviderRequest", () => {
  it("reminder ON + todo visible: guidance text is in the request, signal recorded", async () => {
    const r = await run({ ...withTodo, checklistGuidance: { reminder: true } });
    expect(r.request).toContain(REMINDER);
    expect(r.request).toContain("Guidance:");
    expect(r.out.signalLedger?.filter((s) => s.signalKind === CHECKLIST_REMINDER_SIGNAL_KIND).length).toBe(1);
  });

  it("OFF (default) is byte-identical to baseline, with or without an explicit empty option", async () => {
    const base = await run(withTodo);
    expect((await run({ ...withTodo, checklistGuidance: {} })).request).toBe(base.request);
    expect((await run({ ...withTodo, checklistGuidance: { reminder: false, systemLine: false } })).request).toBe(base.request);
    expect(base.request).not.toContain(REMINDER);
  });

  it("todo absent: options ON change nothing", async () => {
    const base = await run({ availableToolSchemas: [fileWrite] });
    const on = await run({ availableToolSchemas: [fileWrite], checklistGuidance: { reminder: true, systemLine: true } });
    expect(on.request).toBe(base.request);
    expect(on.out.signalLedger ?? []).toEqual(base.out.signalLedger ?? []);
  });

  it("cap: no third reminder once two signals exist", async () => {
    const first = await run({ ...withTodo, checklistGuidance: { reminder: true } });
    const second = await run({ ...withTodo, checklistGuidance: { reminder: true } }, { ...staleState(), signalLedger: first.out.signalLedger });
    expect(second.request).toContain(REMINDER);
    const third = await run({ ...withTodo, checklistGuidance: { reminder: true } }, { ...staleState(), signalLedger: second.out.signalLedger });
    expect(third.request).not.toContain(REMINDER);
  });

  it("M1 line: present only when todo visible AND systemLine on", async () => {
    expect((await run({ ...withTodo, checklistGuidance: { systemLine: true } })).system).toContain(CHECKLIST_SYSTEM_LINE);
    expect((await run({ ...withTodo })).system).not.toContain(CHECKLIST_SYSTEM_LINE);
    expect((await run({ availableToolSchemas: [fileWrite], checklistGuidance: { systemLine: true } })).system).not.toContain(CHECKLIST_SYSTEM_LINE);
  });
});
