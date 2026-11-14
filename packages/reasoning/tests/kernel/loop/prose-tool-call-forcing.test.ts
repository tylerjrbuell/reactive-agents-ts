// File: tests/kernel/loop/prose-tool-call-forcing.test.ts
//
// Local-model campaign 2026-11-13 (RESULTS-P2a/P2b): deepseek-r1 (x6) and
// cogito (x5) narrate "I will use the file-read tool" in prose, never emit the
// call, and the run ends `harness:forcing-unused`. Every one of those runs had
// `actOrAnswer=false`. The mechanism that answers the shape already exists
// (act-or-answer: one forced `toolChoice: "required"` retry per prose stall
// while a declared required tool is outstanding). This pins it END TO END on
// the exact shape, through the real ReAct loop and required-tools guard:
//   - on:  the forced retry returns the call, the tool runs (a successful
//          non-meta receipt), the run succeeds;
//   - on, model never complies: the run ends the same honest required-tool
//          failure as off, in a bounded number of LLM calls, via no new exit;
//   - off: the baseline failure the campaign measured.
// Zero tokens: a scripted LLM + a mock tool service.

import { describe, expect, it } from "bun:test";
import { Effect, Layer, Stream } from "effect";
import {
  LLMService,
  type CompletionRequest,
  type CompletionResponse,
  type StreamEvent,
  type StructuredCompletionRequest,
} from "@reactive-agents/llm-provider";
import { executeReactive } from "../../../src/strategies/reactive.js";
import { defaultReasoningConfig } from "../../../src/types/config.js";
import { mockToolServiceLayer } from "../../../src/testing/tool-service-mock.js";
import { buildRunEnvelope, provideTestEnvelope } from "../../../src/kernel/envelope/run-envelope.js";
import type { ReasoningStep } from "../../../src/types/index.js";

const SCHEMAS = [
  { name: "file-read", description: "Read a file.", parameters: [{ name: "path", type: "string", required: true, description: "path" }] },
];
const usage = { inputTokens: 10, outputTokens: 5, totalTokens: 15, estimatedCost: 0 };
const NARRATION = "I will use the file-read tool to read ./notes.txt and then report what it says. ".repeat(3);
const textTurn = (text: string): readonly StreamEvent[] => [
  { type: "text_delta", text },
  { type: "content_complete", content: text, stopReason: "end_turn" },
  { type: "usage", usage },
];
const callTurn: readonly StreamEvent[] = [
  { type: "tool_use_start", id: "forced-1", name: "file-read" },
  { type: "tool_use_delta", input: JSON.stringify({ path: "./notes.txt" }) },
  { type: "content_complete", content: "", stopReason: "tool_use" },
  { type: "usage", usage },
];

/** Prose to an unforced request; `forced` to a `toolChoice: "required"` one, until a tool result is in the thread. */
function scriptedLLM(requests: CompletionRequest[], complies: boolean) {
  return Layer.succeed(
    LLMService,
    LLMService.of({
      complete: (_r: CompletionRequest) =>
        Effect.succeed<CompletionResponse>({ content: "", stopReason: "end_turn", usage, model: "test" }),
      stream: (request: CompletionRequest) => {
        requests.push(request);
        if (request.toolChoice === "required") return Effect.succeed(Stream.fromIterable(complies ? callTurn : textTurn(NARRATION)));
        const sawResult = JSON.stringify(request.messages).includes("the notes say: forty two");
        return Effect.succeed(
          Stream.fromIterable(textTurn(sawResult ? "FINAL ANSWER: the notes say forty two." : NARRATION)),
        );
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

const toolLayer = mockToolServiceLayer({
  execute: () => Effect.succeed({ success: true, result: "the notes say: forty two" }),
  getTool: (name: string) => Effect.succeed({ name, description: "test", parameters: SCHEMAS[0]!.parameters }),
});

const run = (actOrAnswer: boolean, complies: boolean) => {
  const requests: CompletionRequest[] = [];
  const result = Effect.runPromise(
    executeReactive({
      taskDescription: "Read ./notes.txt with file-read and tell me what it says.",
      taskType: "research",
      memoryContext: "",
      availableTools: ["file-read"],
      availableToolSchemas: SCHEMAS,
      requiredTools: ["file-read"],
      config: {
        ...defaultReasoningConfig,
        strategies: {
          ...defaultReasoningConfig.strategies,
          reactive: { ...defaultReasoningConfig.strategies.reactive, maxIterations: 10, maxIterationsExplicit: true },
        },
      },
      maxIterations: 10,
    } as never).pipe(
      Effect.provide(Layer.merge(scriptedLLM(requests, complies), toolLayer)),
      (eff) => provideTestEnvelope(eff, buildRunEnvelope({ harness: { actOrAnswer, lazyDisclosure: false } })),
    ),
  );
  return result.then((r) => ({ r, requests }));
};

const fileReadReceipts = (steps: readonly ReasoningStep[]) =>
  steps.filter(
    (s) => s.type === "observation" && s.metadata?.observationResult?.toolName === "file-read" && s.metadata.observationResult.success === true,
  ).length;

describe("a model that only narrates a required tool call (campaign: r1, cogito)", () => {
  it("on: the forced retry returns the call, the tool runs, the run succeeds on that receipt", async () => {
    const { r, requests } = await run(true, true);
    expect(r.status).toBe("completed");
    expect(fileReadReceipts((r.steps ?? []) as readonly ReasoningStep[])).toBeGreaterThanOrEqual(1);
    expect(requests.some((q) => q.toolChoice === "required")).toBe(true);
  }, 20000);

  it("on, the model never complies: the same honest required-tool failure as off, bounded, no new exit", async () => {
    const on = await run(true, false);
    const off = await run(false, false);
    // An honest non-success (abstained), identical to the unforced run.
    expect(on.r.status).not.toBe("completed");
    expect(on.r.status).toBe(off.r.status);
    expect(on.r.error).toBe(off.r.error);
    expect((on.r.metadata as Record<string, unknown>).rawTerminatedBy).toBe(
      (off.r.metadata as Record<string, unknown>).rawTerminatedBy,
    );
    expect(fileReadReceipts((on.r.steps ?? []) as readonly ReasoningStep[])).toBe(0);
    // One forced retry per redirect at most: bounded by the required-tool redirect quota.
    const forced = on.requests.filter((q) => q.toolChoice === "required").length;
    expect(forced).toBeGreaterThanOrEqual(1);
    expect(forced).toBeLessThanOrEqual(5);
    expect(on.requests.length).toBeLessThanOrEqual(off.requests.length + forced);
  }, 20000);

  it("off: the baseline the campaign measured - narration only, required tool never called, run fails", async () => {
    const { r, requests } = await run(false, true);
    expect(r.status).not.toBe("completed");
    expect(fileReadReceipts((r.steps ?? []) as readonly ReasoningStep[])).toBe(0);
    expect(requests.every((q) => q.toolChoice !== "required")).toBe(true);
  }, 20000);
});
