// Run: bun test packages/reactive-intelligence/tests/sensor/semantic-embedding-cache.test.ts --timeout 20000
//
// Audit 2026-11-18 cleanup 5: with semantic entropy on, the sensor embedded
// BOTH the thought and the prior thought on every call, although the prior
// thought's embedding was already cached from the previous call, and it kept
// that cache by writing into the caller's `kernelState.meta` in place.
// Now: one embed per call once the cache holds the prior, the first call's
// prior embedding is used as the novelty reference, and the cache lives in
// the service (per task), so `kernelState.meta` is never touched.
// RED-ON-CUT: always embed `[thought, priorThought]` and the embed count
// goes 4 -> 6.
import { describe, expect, it } from "bun:test";
import { Effect, Layer } from "effect";
import { EntropySensorService } from "@reactive-agents/core";
import { LLMService, TestLLMService } from "@reactive-agents/llm-provider";
import { EntropySensorServiceLive } from "../../src/sensor/entropy-sensor-service.js";
import { defaultReactiveIntelligenceConfig } from "../../src/types.js";

const config = {
  ...defaultReactiveIntelligenceConfig,
  entropy: { ...defaultReactiveIntelligenceConfig.entropy, semanticEntropy: true },
};

const spyLLM = () => {
  const embedded: string[][] = [];
  const base = TestLLMService([{ text: "" }]);
  const layer = Layer.succeed(
    LLMService,
    LLMService.of({
      ...base,
      embed: (texts, model) => {
        embedded.push([...texts]);
        return base.embed(texts, model);
      },
    }),
  );
  return { embedded, layer };
};

const kernelState = (taskId: string) => ({
  taskId,
  strategy: "reactive",
  kernelType: "react",
  steps: [],
  toolsUsed: new Set<string>(),
  scratchpad: new Map<string, string>(),
  iteration: 1,
  tokens: 0,
  cost: 0,
  status: "thinking" as const,
  output: null,
  error: null,
  meta: {},
});

describe("semantic entropy reuses the cached prior embedding", () => {
  it("embeds the prior once, then only the new thought; never mutates kernelState.meta", async () => {
    const { embedded, layer } = spyLLM();
    const state = kernelState("sem-cache");
    const thoughts = ["first look at the files", "read the config next", "now compare both values", "write the summary"];
    const scores = await Effect.runPromise(
      Effect.gen(function* () {
        const sensor = yield* EntropySensorService;
        const out = [];
        for (let i = 1; i < thoughts.length; i++) {
          out.push(
            yield* sensor.score({
              thought: thoughts[i]!,
              priorThought: thoughts[i - 1]!,
              taskDescription: "summarize the config",
              strategy: "reactive",
              iteration: i,
              maxIterations: 10,
              modelId: "cogito:14b",
              temperature: 0.3,
              kernelState: state,
            }),
          );
        }
        return out;
      }).pipe(Effect.provide(EntropySensorServiceLive(config).pipe(Layer.provide(layer)))),
    );
    expect(embedded.map((t) => t.length)).toEqual([2, 1, 1]);
    expect(embedded.flat().length).toBe(4);
    expect(state.meta).toEqual({});
    for (const s of scores) expect(s.sources.semantic).not.toBeNull();
  });

  it("the cache is per task: a second task embeds its own prior", async () => {
    const { embedded, layer } = spyLLM();
    await Effect.runPromise(
      Effect.gen(function* () {
        const sensor = yield* EntropySensorService;
        for (const taskId of ["task-a", "task-b"]) {
          yield* sensor.score({
            thought: "second",
            priorThought: "first",
            taskDescription: "t",
            strategy: "reactive",
            iteration: 1,
            maxIterations: 10,
            modelId: "cogito:14b",
            temperature: 0.3,
            kernelState: kernelState(taskId),
          });
        }
      }).pipe(Effect.provide(EntropySensorServiceLive(config).pipe(Layer.provide(layer)))),
    );
    expect(embedded.map((t) => t.length)).toEqual([2, 2]);
  });
});
