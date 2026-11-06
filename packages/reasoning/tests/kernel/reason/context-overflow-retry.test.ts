// Run: bun test packages/reasoning/tests/kernel/reason/context-overflow-retry.test.ts --timeout 20000
//
// Plan 9 Phase 2 item 2d: a provider context-overflow error during think used to
// end the run (`terminatedBy: "llm_error"`) even when a smaller request would have
// fit. Think now re-projects the thread through project() compaction at 0.7x the
// prompt size the provider reported and retries. The recovery is latched ONCE
// PER RUN on a run slot (advisor design, "2d design" in the architecture-
// convergence program): a later overflow in the same run, or a failed retry,
// ends the run honestly. A recovered retry is the `context-overflow-recovered`
// trace fact; an exhausted one is `context-overflow` (`exhausted: true`).
//
// RED-ON-CUT: in context-overflow-retry.ts, make `contextOverflowOf` return
// undefined and the first test fails (one call, run failed); drop the
// `latch.spent` check and the latch test fails (the second overflow retries).
import { describe, expect, it } from "bun:test";
import { Effect, Layer, Ref, Stream } from "effect";
import {
  LLMContextOverflowError,
  LLMError,
  LLMService,
  TestLLMService,
  type CompletionRequest,
  type StreamEvent,
} from "@reactive-agents/llm-provider";
import { EventBus, EventBusLive, rootContext, type AgentEvent } from "@reactive-agents/core";
import { childRunScope, withRunScope } from "@reactive-agents/core/internal/run-scope";
import { TextParseDriver } from "@reactive-agents/tools";
import { handleThinking } from "../../../src/kernel/capabilities/reason/think.js";
import { noopHooks, type KernelContext, type KernelMessage, type KernelState } from "../../../src/kernel/state/kernel-state.js";
import { CONTEXT_PROFILES } from "../../../src/context/context-profile.js";
import { NO_TOOL_EVIDENCE } from "../../../src/kernel/capabilities/verify/requirement-state.js";
import {
  contextOverflowOf,
  overflowRetryWindow,
} from "../../../src/kernel/capabilities/reason/context-overflow-retry.js";

/** A long thread: 30 tool exchanges of ~800 chars each — fits a 32k window, not a 3.5k one. */
function longThread(): KernelMessage[] {
  const messages: KernelMessage[] = [{ role: "user", content: "Do a task" }];
  for (let i = 0; i < 30; i++) {
    const id = `call-${i}`;
    messages.push({ role: "assistant", content: "", toolCalls: [{ id, name: "web-search", arguments: { query: `q${i}` } }] });
    messages.push({ role: "tool_result", toolCallId: id, toolName: "web-search", content: `result ${i}: ${"some data ".repeat(80)}` });
  }
  return messages;
}

function makeState(): KernelState {
  return {
    taskId: "context-overflow",
    strategy: "reactive",
    kernelType: "react",
    steps: [],
    toolsUsed: new Set<string>(),
    scratchpad: new Map<string, string>(),
    iteration: 0,
    tokens: 0,
    cost: 0,
    status: "thinking",
    output: null,
    error: null,
    llmCalls: 0,
    meta: { maxIterations: 10 },
    controllerDecisionLog: [],
    messages: longThread(),
    evidence: NO_TOOL_EVIDENCE,
  } as KernelState;
}

const context: KernelContext = {
  input: { task: "Do a task", availableToolSchemas: [] },
  profile: CONTEXT_PROFILES["mid"],
  compression: { enabled: false, maxResultChars: 4000, previewLines: 10, arrayPreviewItems: 5 },
  toolService: { _tag: "None" },
  hooks: noopHooks,
  toolCallingDriver: new TextParseDriver(),
} as KernelContext;

/** The provider reports a 5,000-token prompt against a 4,096 window: retry window = 0.7 x 5,000. */
const overflow = () =>
  new LLMContextOverflowError({ message: "prompt is too long", tokenCount: 5000, maxTokens: 4096, errorClass: "context_overflow" });

const answer: StreamEvent[] = [
  { type: "text_delta", text: "Final answer: done." },
  { type: "content_complete", content: "Final answer: done.", stopReason: "end_turn" },
  { type: "usage", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, estimatedCost: 0 } },
];

type Reply = "overflow" | "other-error" | "answer";
type Scope = "run" | "none";

/**
 * Run one think call per entry of `calls` (each a reply script). `scope: "run"`
 * runs every call inside ONE run scope (the latch is shared); `"none"` binds no
 * run scope at all.
 */
async function think(calls: readonly (readonly Reply[])[], scope: Scope = "run") {
  const requests: CompletionRequest[] = [];
  const replies = calls.flat();
  const base = TestLLMService([{ text: "" }]);
  const layer = Layer.succeed(
    LLMService,
    LLMService.of({
      ...base,
      stream: (req: CompletionRequest) => {
        const reply = replies[requests.length] ?? "answer";
        requests.push(req);
        if (reply === "overflow") return Effect.fail(overflow());
        if (reply === "other-error") return Effect.fail(new LLMError({ message: "boom", provider: "anthropic" }));
        return Effect.succeed(Stream.fromIterable(answer));
      },
    }),
  );
  const program = Effect.gen(function* () {
    const events = yield* Ref.make<AgentEvent[]>([]);
    const bus = yield* EventBus;
    yield* bus.subscribe((ev) => Ref.update(events, (xs) => [...xs, ev]));
    const results: KernelState[] = [];
    for (const script of calls) {
      const before = requests.length;
      const result = yield* handleThinking(makeState(), context);
      results.push(result);
      // Skip replies a call did not consume (a latched call makes one request).
      const consumed = requests.length - before;
      if (consumed < script.length) replies.splice(requests.length, script.length - consumed);
    }
    const signals = (yield* Ref.get(events)).flatMap((e) =>
      e._tag === "HarnessSignalInjectedEmitted" && e.origin.startsWith("context-overflow") ? [e] : [],
    );
    return { results, result: results[0]!, signals, requests };
  }).pipe(Effect.provide(Layer.mergeAll(layer, EventBusLive)));
  return Effect.runPromise(scope === "run" ? program.pipe(withRunScope(rootContext("overflow-run", "agent"))) : program);
}

const chars = (req: CompletionRequest): number =>
  req.messages.reduce((n, m) => n + (typeof m.content === "string" ? m.content.length : JSON.stringify(m.content).length), 0);

describe("context overflow during think: one compact-and-retry per run", () => {
  it("retries once with a smaller projected thread at 0.7x the reported overflow, then records the recovery", async () => {
    const { result, signals, requests } = await think([["overflow", "answer"]]);
    expect(requests).toHaveLength(2);
    expect(requests[1]!.messages.length).toBeLessThan(requests[0]!.messages.length);
    expect(chars(requests[1]!)).toBeLessThan(chars(requests[0]!));
    expect(result.status).not.toBe("failed");
    expect(result.meta.terminatedBy).not.toBe("llm_error");
    expect(signals).toHaveLength(1);
    expect(signals[0]!.origin).toBe("context-overflow-recovered");
    expect(signals[0]!.metadata).toMatchObject({ retryWindow: 3500, tokenCount: 5000, maxTokens: 4096 });
  });

  it("latched once per run: a later overflow in the same run is not retried", async () => {
    const { results, signals, requests } = await think([["overflow", "answer"], ["overflow", "answer"]]);
    expect(results[0]!.status).not.toBe("failed");
    expect(requests).toHaveLength(3); // overflow + retry, then the latched overflow alone
    expect(results[1]!.status).toBe("failed");
    expect(results[1]!.meta.terminatedBy).toBe("llm_error");
    expect(signals.map((s) => [s.origin, s.metadata?.latched ?? null])).toEqual([
      ["context-overflow-recovered", null],
      ["context-overflow", true],
    ]);
  });

  it("a sub-agent's run scope gets its own recovery", async () => {
    const requests: number[] = [];
    let calls = 0;
    const layer = Layer.succeed(
      LLMService,
      LLMService.of({
        ...TestLLMService([{ text: "" }]),
        stream: () => {
          calls++;
          requests.push(calls);
          return calls % 2 === 1 ? Effect.fail(overflow()) : Effect.succeed(Stream.fromIterable(answer));
        },
      }),
    );
    const [parent, child] = await Effect.runPromise(
      Effect.gen(function* () {
        const p = yield* handleThinking(makeState(), context);
        const c = yield* handleThinking(makeState(), context).pipe(childRunScope(rootContext("overflow-child", "sub-agent")));
        return [p, c] as const;
      }).pipe(Effect.provide(Layer.mergeAll(layer, EventBusLive)), withRunScope(rootContext("overflow-parent", "agent"))),
    );
    expect(requests).toHaveLength(4);
    expect(parent.status).not.toBe("failed");
    expect(child.status).not.toBe("failed");
  });

  it("CONTROL: a failed retry ends the run honestly, no loop", async () => {
    const { result, signals, requests } = await think([["overflow", "overflow", "answer"]]);
    expect(requests).toHaveLength(2);
    expect(result.status).toBe("failed");
    expect(result.meta.terminatedBy).toBe("llm_error");
    expect(signals.map((s) => [s.origin, s.metadata])).toMatchObject([
      ["context-overflow", { exhausted: true, latched: false, retryWindow: 3500 }],
    ]);
  });

  it("CONTROL: a non-overflow failure is not retried", async () => {
    const { result, signals, requests } = await think([["other-error", "answer"]]);
    expect(requests).toHaveLength(1);
    expect(result.status).toBe("failed");
    expect(result.meta.terminatedBy).toBe("llm_error");
    expect(signals).toHaveLength(0);
  });

  it("CONTROL: with no run scope bound, each call keeps its own retry (no process-wide latch)", async () => {
    const { results, requests } = await think([["overflow", "answer"], ["overflow", "answer"]], "none");
    expect(requests).toHaveLength(4);
    expect(results.map((r) => r.status === "failed")).toEqual([false, false]);
  });
});

describe("context-overflow-retry (seam pin)", () => {
  it("contextOverflowOf reads only the typed overflow error", () => {
    expect(contextOverflowOf(overflow())).toEqual({ tokenCount: 5000, maxTokens: 4096 });
    expect(contextOverflowOf(new LLMError({ message: "x", provider: "anthropic" }))).toBeUndefined();
    expect(contextOverflowOf("prompt is too long")).toBeUndefined();
  });

  it("overflowRetryWindow is 0.7x the reported overflow, else 0.7x the projected window, never wider", () => {
    const profile = { ...CONTEXT_PROFILES["mid"], explicitNumCtx: 32_000 };
    expect(overflowRetryWindow(profile, { tokenCount: 9000, maxTokens: 8000 })).toBe(6300);
    expect(overflowRetryWindow(profile, { tokenCount: 0, maxTokens: 8000 })).toBe(22_400);
    expect(overflowRetryWindow(profile, { tokenCount: 100_000, maxTokens: 0 })).toBe(22_400);
  });
});
