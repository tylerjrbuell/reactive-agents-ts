// Run: bun test packages/reasoning/tests/kernel/tool-result-pairing.test.ts --timeout 20000
//
// Every executed tool call's result reaches the model on the next think
// (owner report 2026-11-10, Cortex traces 01M745M4CSCS…, 01M745S366TC…).
//
// Root cause: act.ts captured the run scratchpad Map ONCE per round
// (`Ref.get(currentScratchpadStore)`) and compressed results were written into
// that captured Map. `find` stores its full result with `Ref.update(…, new Map)`,
// which REPLACES the Ref's Map. The round-end sync then read the new Map, so
// `_tool_result_N` (the compressed find result's storedKey) never reached
// `state.scratchpad`; `from-kernel-state` minted the tool_result event with a
// ref the ResultStore did not hold, and `projectResultsStage` dropped the
// message silently. The model saw `[tool_use:find]` with no result, plus
// guidance claiming "You have tool results above".
//
// Pins:
//  (a) a find-like tool that replaces the run store AND returns a compressed
//      result: its tool message is in the next request, the storedKey is in
//      state.scratchpad and in the run store (recall works), no pairing signal.
//  (b) find + recall in the same turn: both tool messages are visible.
//  (c) the pairing invariant: a storedKey missing from the scratchpad still
//      projects the message's own content AND is recorded; an unanswered
//      tool_use is recorded; the kernel emits a `tool-result-pairing` guard.
//  (d) the act reminder ("You have tool results above") renders only when the
//      projected thread carries a tool result.
//
// RED-ON-CUT: (a)/(b) fail with act.ts's sync reverted to reading the Ref
// alone; (c) fails with the from-kernel-state fallback or the project-results
// pairing record cut; (d) fails with `guidanceForProjectedThread` returning its
// input unchanged.
import { describe, expect, it } from "bun:test";
import { Effect, Layer, Ref } from "effect";
import {
  LLMService,
  TestLLMService,
  type CompletionRequest,
  type LLMMessage,
} from "@reactive-agents/llm-provider";
import { EventBus, EventBusLive, rootContext, type AgentEvent } from "@reactive-agents/core";
import { withRunScope } from "@reactive-agents/core/internal/run-scope";
import { currentScratchpadStore } from "@reactive-agents/tools";
import { mockToolServiceLayer } from "../../src/testing/tool-service-mock.js";
import { reactKernel } from "../../src/kernel/loop/react-kernel.js";
import { runPass } from "../../src/kernel/loop/run-pass.js";
import type { KernelInput, KernelRunOptions, KernelState } from "../../src/kernel/state/kernel-state.js";
import { initialKernelState } from "../../src/kernel/state/kernel-state.js";
import { fromKernelState } from "../../src/assembly/from-kernel-state.js";
import { project } from "../../src/assembly/project.js";
import { CONTEXT_PROFILES } from "../../src/context/context-profile.js";
import {
  TOOL_RESULT_PAIRING_GUARD,
  emitToolResultPairing,
  guidanceForProjectedThread,
} from "../../src/kernel/capabilities/reason/tool-result-pairing.js";

const SCHEMAS = [
  { name: "find", description: "search documents", parameters: [{ name: "query", type: "string", required: true }] },
  { name: "recall", description: "read a stored key", parameters: [{ name: "key", type: "string", required: true }] },
];

/** A find-shaped result big enough to be compressed (stored under `_tool_result_N`). */
const bigFindResult = {
  query: "AGENTS.md",
  results: Array.from({ length: 6 }, (_, i) => ({
    content: `Chunk ${i} of AGENTS.md — ${"agent contract text ".repeat(40)}`,
    source: "documents",
    identifier: "AGENTS.md",
    score: 1,
  })),
  totalResults: 6,
  hint: "Matched document 'AGENTS.md' by name.",
  storedAs: "_find_1",
};

/** Mirrors find.ts: the full result is stored by REPLACING the run store's Map. */
const findLikeExecute = (req: { toolName: string; args?: unknown }) =>
  Effect.gen(function* () {
    const ref = yield* currentScratchpadStore;
    if (req.toolName === "find") {
      yield* Ref.update(ref, (m) => {
        const next = new Map(m);
        next.set("_find_1", JSON.stringify(bigFindResult));
        return next;
      });
      return { success: true, result: bigFindResult };
    }
    return { success: true, result: { found: false, key: "x" } };
  });

const input = (): KernelInput =>
  ({
    task: "What does AGENTS.md say?",
    availableToolSchemas: SCHEMAS,
    allToolSchemas: SCHEMAS,
    contextProfile: { tier: "local", toolResultMaxChars: 600 },
  }) as KernelInput;

const opts: KernelRunOptions = {
  maxIterations: 4,
  strategy: "reactive",
  kernelType: "react",
  taskId: "tool-result-pairing-test",
  modelId: "tinyllama",
};

async function runWith(firstTurnCalls: ReadonlyArray<{ name: string; args: Record<string, unknown> }>) {
  const requests: CompletionRequest[] = [];
  const base = TestLLMService([{ toolCalls: [...firstTurnCalls] }, { text: "AGENTS.md is the agent contract." }]);
  const llm = Layer.succeed(
    LLMService,
    LLMService.of({
      ...base,
      stream: (req: CompletionRequest) => {
        requests.push(req);
        return base.stream(req);
      },
      complete: (req: CompletionRequest) => {
        requests.push(req);
        return base.complete(req);
      },
    }),
  );
  const program = Effect.gen(function* () {
    const events = yield* Ref.make<AgentEvent[]>([]);
    const bus = yield* EventBus;
    yield* bus.subscribe((ev) => Ref.update(events, (xs) => [...xs, ev]));
    const pass = yield* runPass(reactKernel, input(), opts);
    const runStore = yield* Ref.get(yield* currentScratchpadStore);
    const pairingGuards = (yield* Ref.get(events)).filter(
      (e) => e._tag === "GuardFiredEmitted" && e.guard === "tool-result-pairing",
    );
    return { pass, runStore, pairingGuards };
  }).pipe(
    Effect.provide(Layer.mergeAll(llm, mockToolServiceLayer({ execute: findLikeExecute }), EventBusLive)),
    withRunScope(rootContext("tool-result-pairing-run", "agent")),
  );
  const out = await Effect.runPromise(program);
  return { ...out, requests };
}

/** The request that followed the first tool round (the first one carrying a tool_use). */
const followUp = (requests: readonly CompletionRequest[]): readonly LLMMessage[] => {
  const req = requests.find((r) => r.messages.some((m) => m.role === "assistant"));
  expect(req).toBeDefined();
  return req!.messages;
};

/** tool_use ids in the request's assistant turns (toLLMMessages renders calls as content blocks). */
const toolCallIds = (messages: readonly LLMMessage[]): string[] =>
  messages.flatMap((m) =>
    m.role === "assistant" && typeof m.content !== "string"
      ? m.content.flatMap((b) => (b.type === "tool_use" ? [b.id] : []))
      : [],
  );

const toolMessageFor = (messages: readonly LLMMessage[], id: string) =>
  messages.find((m) => m.role === "tool" && m.toolCallId === id);

const textOf = (m: LLMMessage | undefined): string =>
  m === undefined ? "" : typeof m.content === "string" ? m.content : JSON.stringify(m.content);

describe("tool-result pairing — every executed call's result reaches the model", () => {
  it("(a) a compressed find result whose tool replaced the run store is visible, stored and recallable", async () => {
    const { pass, runStore, pairingGuards, requests } = await runWith([{ name: "find", args: { query: "AGENTS.md" } }]);
    const messages = followUp(requests);
    const ids = toolCallIds(messages);
    expect(ids.length).toBe(1);
    const toolMsg = toolMessageFor(messages, ids[0]!);
    expect(toolMsg).toBeDefined();
    expect(textOf(toolMsg)).toContain("AGENTS.md");

    const storedKeys = [...pass.state.scratchpad.keys()].filter((k) => k.startsWith("_tool_result_"));
    expect(storedKeys.length).toBe(1);
    // The run store (what `recall` reads) holds the kernel's key AND the tool's own key.
    expect(runStore.has(storedKeys[0]!)).toBe(true);
    expect(runStore.has("_find_1")).toBe(true);
    // The thread was whole: the pairing invariant never had to recover anything.
    expect(pairingGuards).toEqual([]);
  });

  it("(b) find + recall in the same turn: both results are visible", async () => {
    const { requests, pairingGuards } = await runWith([
      { name: "find", args: { query: "AGENTS.md" } },
      { name: "recall", args: { key: "x" } },
    ]);
    const messages = followUp(requests);
    const ids = toolCallIds(messages);
    expect(ids.length).toBe(2);
    for (const id of ids) expect(toolMessageFor(messages, id)).toBeDefined();
    expect(pairingGuards).toEqual([]);
  });
});

const profile = CONTEXT_PROFILES.local;

const stateWith = (messages: KernelState["messages"], scratchpad: ReadonlyMap<string, string> = new Map()): KernelState =>
  ({ ...initialKernelState({ taskId: "pairing-unit", strategy: "reactive", kernelType: "react" }), messages, scratchpad }) as KernelState;

describe("tool-result pairing — the assembly invariant", () => {
  it("(c1) a storedKey missing from the scratchpad still projects the message's own preview and is recorded", () => {
    const preview = "[STORED: _tool_result_1 | find]\nType: Object(3 keys)\n  results: 3 records about AGENTS.md";
    const state = stateWith([
      { role: "user", content: "What does AGENTS.md say?" },
      { role: "assistant", content: "", toolCalls: [{ id: "tc-1", name: "find", arguments: { query: "AGENTS.md" } }] },
      { role: "tool_result", toolCallId: "tc-1", toolName: "find", content: preview, storedKey: "_tool_result_1" },
    ]);
    const { request, trace } = project(fromKernelState(state, profile, { system: "s" }, { schemas: [] }, "task"));
    const tool = request.messages.find((m) => m.role === "tool_result");
    expect(tool).toBeDefined();
    expect(String(tool && "content" in tool ? tool.content : "")).toContain("_tool_result_1");
    expect(trace.pairing?.recoveredRefs).toEqual(["_tool_result_1"]);
    expect(trace.pairing?.unpairedCallIds).toEqual([]);
  });

  it("(c2) a tool_use with no result is recorded as unpaired, never silently", () => {
    const state = stateWith([
      { role: "user", content: "go" },
      { role: "assistant", content: "", toolCalls: [{ id: "tc-9", name: "find", arguments: {} }] },
    ]);
    const { trace } = project(fromKernelState(state, profile, { system: "s" }, { schemas: [] }, "task"));
    expect(trace.pairing?.unpairedCallIds).toEqual(["tc-9"]);
  });

  it("(c4) a pairing break is published as a `tool-result-pairing` guard event", async () => {
    const state = stateWith([
      { role: "user", content: "go" },
      { role: "assistant", content: "", toolCalls: [{ id: "tc-9", name: "find", arguments: {} }] },
    ]);
    const { trace } = project(fromKernelState(state, profile, { system: "s" }, { schemas: [] }, "task"));
    const guards = await Effect.runPromise(
      Effect.gen(function* () {
        const events = yield* Ref.make<AgentEvent[]>([]);
        const bus = yield* EventBus;
        yield* bus.subscribe((ev) => Ref.update(events, (xs) => [...xs, ev]));
        yield* emitToolResultPairing(trace, "t", 1);
        return (yield* Ref.get(events)).flatMap((e) => (e._tag === "GuardFiredEmitted" ? [e] : []));
      }).pipe(Effect.provide(EventBusLive)),
    );
    expect(guards.map((g) => [g.guard, g.outcome, g.metadata?.unpairedCallIds])).toEqual([
      [TOOL_RESULT_PAIRING_GUARD, "warn", ["tc-9"]],
    ]);
  });

  it("(c3) a whole thread records no pairing trace (byte-identical default)", () => {
    const state = stateWith(
      [
        { role: "user", content: "go" },
        { role: "assistant", content: "", toolCalls: [{ id: "tc-2", name: "find", arguments: {} }] },
        { role: "tool_result", toolCallId: "tc-2", toolName: "find", content: "small", storedKey: "_tool_result_1" },
      ],
      new Map([["_tool_result_1", "small"]]),
    );
    const { trace } = project(fromKernelState(state, profile, { system: "s" }, { schemas: [] }, "task"));
    expect(trace.pairing).toBeUndefined();
  });
});

describe("tool-result pairing — guidance honesty", () => {
  const reminder = "You have tool results above. If you have what you need, give your final answer now.";

  it("(d1) the act reminder is dropped when the projected thread has no tool result", () => {
    const out = guidanceForProjectedThread({ actReminder: reminder, errorRecovery: "x" }, [
      { role: "user", content: "go" },
    ]);
    expect(out.actReminder).toBeUndefined();
    expect(out.errorRecovery).toBe("x");
  });

  it("(d2) the act reminder stays when a tool result is in the thread", () => {
    const g = { actReminder: reminder };
    const out = guidanceForProjectedThread(g, [
      { role: "user", content: "go" },
      { role: "assistant", content: "", toolCalls: [{ id: "a", name: "find", arguments: {} }] },
      { role: "tool_result", toolCallId: "a", toolName: "find", content: "r" },
    ]);
    expect(out).toBe(g);
  });
});
