/**
 * seam-llm-start-provider.test.ts — LLMRequestStarted names the real provider.
 *
 * The kernel sends `model` as a bare string, so the request never names the
 * provider. The COMPLETED half already fell back to the wrapped service's
 * `getModelConfig().provider`; the START half read "unknown" for every
 * string-model call (QA 2026-11-11). Both halves now share one resolver.
 */
import { describe, it, expect } from "bun:test";
import { Effect, Layer, Stream } from "effect";
import { LLMService, type CompletionRequest, type CompletionResponse, type StreamEvent } from "@reactive-agents/llm-provider";
import { EventBus, rootContext, type AgentEvent } from "@reactive-agents/core";
import { withRunScope } from "@reactive-agents/core/internal/run-scope";
import { makeObservableLLM } from "../../src/kernel/observable-llm.js";

type Recorded = Readonly<Record<string, unknown>> & { readonly _tag: string };
const record = (event: AgentEvent): Recorded => ({ ...event });

const response: CompletionResponse = {
  content: "ok",
  stopReason: "end_turn",
  usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, estimatedCost: 0 },
  model: "qwen3:4b",
};

const streamEvents: readonly StreamEvent[] = [{ type: "content_complete", content: "ok" }];

const ollamaDouble: LLMService["Type"] = {
  complete: () => Effect.succeed(response),
  stream: () => Effect.succeed(Stream.fromIterable(streamEvents)),
  completeStructured: () => Effect.die("unused: completeStructured"),
  embed: () => Effect.succeed([]),
  countTokens: () => Effect.succeed(0),
  getModelConfig: () => Effect.succeed({ provider: "ollama", model: "qwen3:4b" }),
  getStructuredOutputCapabilities: () => Effect.die("unused"),
  capabilities: () => Effect.die("unused"),
};
const innerOllama = Layer.succeed(LLMService, ollamaDouble);

function busLayer(events: Recorded[]): Layer.Layer<EventBus> {
  return Layer.succeed(EventBus, {
    publish: (event) => {
      events.push(record(event));
      return Effect.void;
    },
    subscribe: () => Effect.succeed(() => {}),
    on: () => Effect.succeed(() => {}),
  } as EventBus["Type"]);
}

const request: CompletionRequest = {
  model: "qwen3:4b",
  messages: [{ role: "user", content: "hi" }],
};

async function startedProviders(call: (llm: LLMService["Type"]) => Effect.Effect<unknown, unknown>): Promise<unknown[]> {
  const events: Recorded[] = [];
  const program = Effect.gen(function* () {
    const llm = yield* LLMService;
    yield* call(llm);
  }).pipe(
    Effect.provide(makeObservableLLM().pipe(Layer.provide(innerOllama))),
    Effect.provide(busLayer(events)),
    withRunScope(rootContext("start-provider-run", "agent")),
  );
  await Effect.runPromise(Effect.orDie(program));
  return events.filter((e) => e._tag === "LLMRequestStarted").map((e) => e.provider);
}

describe("LLMRequestStarted.provider falls back to the wrapped service's provider", () => {
  it("complete(): string model + ambient run → provider 'ollama'", async () => {
    expect(await startedProviders((llm) => llm.complete(request))).toEqual(["ollama"]);
  });

  it("stream(): string model + ambient run → provider 'ollama'", async () => {
    const providers = await startedProviders((llm) =>
      Effect.flatMap(llm.stream(request), (s) => Stream.runDrain(s)),
    );
    expect(providers).toEqual(["ollama"]);
  });
});
