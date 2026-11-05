// Run: bun test packages/reasoning/tests/kernel/reason/context-overflow-retry.test.ts --timeout 20000
//
// Plan 9 Phase 2 item 2d: a provider context-overflow error during think used to
// end the run (`terminatedBy: "llm_error"`) even when a smaller request would have
// fit. Think now re-projects the thread once through project() compaction at a
// tighter window and retries; a second overflow ends the run honestly. Exactly
// one retry per think call; each decision is a `context-overflow` trace signal.
//
// RED-ON-CUT: in context-overflow-retry.ts, make `contextOverflowOf` return
// undefined and the first test fails (one call, run failed).
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
import { EventBus, EventBusLive, type AgentEvent } from "@reactive-agents/core";
import { TextParseDriver } from "@reactive-agents/tools";
import { handleThinking } from "../../../src/kernel/capabilities/reason/think.js";
import { noopHooks, type KernelContext, type KernelMessage, type KernelState } from "../../../src/kernel/state/kernel-state.js";
import { CONTEXT_PROFILES } from "../../../src/context/context-profile.js";
import { NO_TOOL_EVIDENCE } from "../../../src/kernel/capabilities/verify/requirement-state.js";
import {
  contextOverflowOf,
  overflowRetryWindow,
} from "../../../src/kernel/capabilities/reason/context-overflow-retry.js";

/** A long thread: 30 tool exchanges of ~800 chars each — fits a 32k window, not a 4k one. */
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

const overflow = () =>
  new LLMContextOverflowError({ message: "prompt is too long", tokenCount: 9000, maxTokens: 8000, errorClass: "context_overflow" });

const answer: StreamEvent[] = [
  { type: "text_delta", text: "Final answer: done." },
  { type: "content_complete", content: "Final answer: done.", stopReason: "end_turn" },
  { type: "usage", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, estimatedCost: 0 } },
];

type Reply = "overflow" | "other-error" | "answer";

async function think(replies: readonly Reply[]) {
  const requests: CompletionRequest[] = [];
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
  return Effect.runPromise(
    Effect.gen(function* () {
      const events = yield* Ref.make<AgentEvent[]>([]);
      const bus = yield* EventBus;
      yield* bus.subscribe((ev) => Ref.update(events, (xs) => [...xs, ev]));
      const result = yield* handleThinking(makeState(), context);
      const signals = (yield* Ref.get(events)).flatMap((e) =>
        e._tag === "HarnessSignalInjectedEmitted" && e.origin === "context-overflow" ? [e] : [],
      );
      return { result, signals, requests };
    }).pipe(Effect.provide(Layer.mergeAll(layer, EventBusLive))),
  );
}

const chars = (req: CompletionRequest): number =>
  req.messages.reduce((n, m) => n + (typeof m.content === "string" ? m.content.length : JSON.stringify(m.content).length), 0);

describe("context overflow during think: one compact-and-retry", () => {
  it("retries once with a smaller projected thread and succeeds", async () => {
    const { result, signals, requests } = await think(["overflow", "answer"]);
    expect(requests).toHaveLength(2);
    expect(requests[1]!.messages.length).toBeLessThan(requests[0]!.messages.length);
    expect(chars(requests[1]!)).toBeLessThan(chars(requests[0]!));
    expect(result.status).not.toBe("failed");
    expect(result.meta.terminatedBy).not.toBe("llm_error");
    expect(signals).toHaveLength(1);
    expect(signals[0]!.metadata).toMatchObject({ attempt: 1, exhausted: false, retryWindow: 4000, maxTokens: 8000 });
  });

  it("CONTROL: a second overflow ends the run honestly, no loop", async () => {
    const { result, signals, requests } = await think(["overflow", "overflow", "answer"]);
    expect(requests).toHaveLength(2);
    expect(result.status).toBe("failed");
    expect(result.meta.terminatedBy).toBe("llm_error");
    expect(signals.map((s) => s.metadata)).toMatchObject([
      { attempt: 1, exhausted: false },
      { attempt: 2, exhausted: true },
    ]);
  });

  it("CONTROL: a non-overflow failure is not retried", async () => {
    const { result, signals, requests } = await think(["other-error", "answer"]);
    expect(requests).toHaveLength(1);
    expect(result.status).toBe("failed");
    expect(result.meta.terminatedBy).toBe("llm_error");
    expect(signals).toHaveLength(0);
  });
});

describe("context-overflow-retry (seam pin)", () => {
  it("contextOverflowOf reads only the typed overflow error", () => {
    expect(contextOverflowOf(overflow())).toEqual({ tokenCount: 9000, maxTokens: 8000 });
    expect(contextOverflowOf(new LLMError({ message: "x", provider: "anthropic" }))).toBeUndefined();
    expect(contextOverflowOf("prompt is too long")).toBeUndefined();
  });

  it("overflowRetryWindow halves the smaller of the projected and stated windows", () => {
    const profile = { ...CONTEXT_PROFILES["mid"], explicitNumCtx: 32_000 };
    expect(overflowRetryWindow(profile, 8000)).toBe(4000);
    expect(overflowRetryWindow(profile, 0)).toBe(16_000);
    expect(overflowRetryWindow(profile, 100_000)).toBe(16_000);
  });
});
