// Run: bun test packages/reasoning/tests/kernel/carried-thread-scratchpad.test.ts --timeout 20000
//
// A kernel pass seeded with a prior pass's thread (`initialMessages`) must
// start with a scratchpad that resolves every stored tool-result ref in that
// thread (harness report 2026-11-19, Cortex reflexion trace
// 01M7T8XTQEARASBWPNVYEEZJZ0). Reflexion carries the old messages into each
// improve pass, but a fresh pass started with an EMPTY scratchpad: the carried
// `_tool_result_1` ref was missing, the projection fell back to the message's
// cut preview (5 of 20 rows, no recall hint), a `tool-result-pairing` guard
// fired on the first think of every later pass, and the model never re-fetched.
//
// The keys are minted run-wide, so the runner seeds the carried refs from the
// run's scratchpad store (kernel/state/pass-seed.ts `seedCarriedScratchpad`).
//
// RED-ON-CUT: with the `seedCarriedScratchpad` call removed from the runner (or
// the helper returning its input), pass 2 fires the pairing guard and its tool
// message differs from pass 1's projection of the same result.
import { describe, expect, it } from "bun:test";
import { Effect, Layer, Ref } from "effect";
import { LLMService, TestLLMService, type CompletionRequest, type LLMMessage } from "@reactive-agents/llm-provider";
import { EventBus, EventBusLive, rootContext, type AgentEvent } from "@reactive-agents/core";
import { withRunScope } from "@reactive-agents/core/internal/run-scope";
import { mockToolServiceLayer } from "../../src/testing/tool-service-mock.js";
import { reactKernel } from "../../src/kernel/loop/react-kernel.js";
import { runPass } from "../../src/kernel/loop/run-pass.js";
import type { KernelInput, KernelRunOptions } from "../../src/kernel/state/kernel-state.js";
import { initialKernelState, transitionState } from "../../src/kernel/state/kernel-state.js";
import { seedCarriedScratchpad } from "../../src/kernel/state/pass-seed.js";
import { currentScratchpadStore } from "@reactive-agents/tools";

const SCHEMAS = [
  { name: "get_metrics", description: "site metrics", parameters: [{ name: "type", type: "string", required: true }] },
];

/** A 20-row result big enough to overflow and be stored under `_tool_result_N`. */
const bigResult = {
  type: "path",
  rows: Array.from({ length: 20 }, (_, i) => ({ x: `/page-${i}-${"segment".repeat(6)}`, y: 1000 - i })),
};

const input = (extra: Partial<KernelInput> = {}): KernelInput =>
  ({
    task: "Which pages get the most traffic?",
    availableToolSchemas: SCHEMAS,
    allToolSchemas: SCHEMAS,
    contextProfile: { tier: "local", toolResultMaxChars: 600 },
    ...extra,
  }) as KernelInput;

const opts = (pass: string): KernelRunOptions => ({
  maxIterations: 4,
  strategy: "reflexion",
  kernelType: "react",
  taskId: "carried-thread-scratchpad",
  kernelPass: pass,
  modelId: "tinyllama",
});

const isPairing = (e: AgentEvent): boolean => e._tag === "GuardFiredEmitted" && e.guard === "tool-result-pairing";

const toolText = (messages: readonly LLMMessage[]): string => {
  const m = messages.find((x) => x.role === "tool");
  return m === undefined ? "" : typeof m.content === "string" ? m.content : JSON.stringify(m.content);
};

async function twoPasses() {
  const requests: CompletionRequest[] = [];
  const base = TestLLMService([
    { toolCalls: [{ name: "get_metrics", args: { type: "path" } }] },
    { text: "Top page is /page-0." },
    { text: "Improved: top page is /page-0 with 1000 views." },
  ]);
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
    const first = yield* runPass(reactKernel, input(), opts("reflexion:generate"));
    const pass1Pairing = (yield* Ref.get(events)).filter(isPairing).length;
    const pass2RequestStart = requests.length;
    const second = yield* runPass(reactKernel, input({ initialMessages: first.state.messages }), opts("reflexion:improve-1"));
    const pass2Pairing = (yield* Ref.get(events)).slice().filter(isPairing).length - pass1Pairing;
    return { first, second, pass1Pairing, pass2Pairing, pass2RequestStart };
  }).pipe(
    Effect.provide(Layer.mergeAll(llm, mockToolServiceLayer({ execute: () => Effect.succeed({ success: true, result: bigResult }) }), EventBusLive)),
    withRunScope(rootContext("carried-thread-scratchpad-run", "agent")),
  );
  const out = await Effect.runPromise(program);
  return { ...out, requests };
}

describe("carried thread — the seeded pass resolves every carried stored ref", () => {
  it("pass 2 sees pass 1's stored tool result exactly as pass 1 did, with no pairing break", async () => {
    const { first, second, pass1Pairing, pass2Pairing, pass2RequestStart, requests } = await twoPasses();
    const storedKeys = [...first.state.scratchpad.keys()].filter((k) => k.startsWith("_tool_result_"));
    expect(storedKeys.length).toBe(1);
    const key = storedKeys[0]!;
    // Pass 1's thread carries the ref on its tool_result message.
    expect(first.state.messages.some((m) => m.role === "tool_result" && m.storedKey === key)).toBe(true);
    expect(pass1Pairing).toBe(0);

    // Pass 2's first projection shows the carried result as pass 1's follow-up did.
    const pass1FollowUp = requests.slice(0, pass2RequestStart).find((r) => r.messages.some((m) => m.role === "tool"));
    const pass2First = requests.slice(pass2RequestStart).find((r) => r.messages.some((m) => m.role === "tool"));
    expect(pass1FollowUp).toBeDefined();
    expect(pass2First).toBeDefined();
    expect(toolText(pass2First!.messages)).toBe(toolText(pass1FollowUp!.messages));
    expect(pass2Pairing).toBe(0);

    // The seeded pass starts with the carried ref resolvable.
    expect(second.state.scratchpad.get(key)).toBe(first.state.scratchpad.get(key));
  });
});

describe("seedCarriedScratchpad — unit", () => {
  const base = initialKernelState({ taskId: "seed-unit", strategy: "reflexion", kernelType: "react" });
  const carried = transitionState(base, {
    messages: [
      { role: "tool_result", toolCallId: "c1", toolName: "get_metrics", content: "cut preview", storedKey: "_tool_result_1" },
    ],
  });
  const withStore = (entries: Record<string, string>) =>
    <A>(eff: Effect.Effect<A>) =>
      Effect.runPromise(
        Effect.gen(function* () {
          yield* Ref.set(yield* currentScratchpadStore, new Map(Object.entries(entries)));
          return yield* eff;
        }).pipe(withRunScope(rootContext("seed-unit-run", "agent"))),
      );

  it("copies only the carried refs from the run store", async () => {
    const out = await withStore({ _tool_result_1: "FULL", _tool_result_9: "OTHER" })(seedCarriedScratchpad(carried, {}));
    expect([...out.scratchpad.entries()]).toEqual([["_tool_result_1", "FULL"]]);
  });

  it("returns the state by identity when nothing is carried, on resume, or when the store lacks the ref", async () => {
    expect(await withStore({ _tool_result_1: "FULL" })(seedCarriedScratchpad(base, {}))).toBe(base);
    expect(await withStore({ _tool_result_1: "FULL" })(seedCarriedScratchpad(carried, { resumeState: carried }))).toBe(carried);
    expect(await withStore({})(seedCarriedScratchpad(carried, {}))).toBe(carried);
  });
});
