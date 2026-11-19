// Run: bun test packages/runtime/tests/seam-with-model-params.test.ts --timeout 20000
/**
 * `.withModel(modelId, params)` overload (owner decision 2026-11-19).
 *
 * The owner wrote `.withModel("gemma4:e4b", { numCtx: 8000 })`; no overload
 * matched, the runtime read only the first argument, and Ollama loaded the
 * model at 32,768. These pins hold that:
 *  - the two-argument form writes the same builder slots as the object form,
 *  - numCtx reaches `toConfig()`, survives `fromConfig()`, and is recorded on
 *    `run-started.config.builder`,
 *  - a wrong-shaped argument or unknown key fails at the call with
 *    `ModelOptionError` instead of being dropped.
 * Direct-import seam: `applyWithModel` in `builder/withers/model-budget.ts`.
 */
import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _resetProbedRegistryForTesting } from "@reactive-agents/llm-provider";
import { loadTrace } from "@reactive-agents/trace";
import { ReactiveAgentBuilder, ReactiveAgents } from "../src/builder.js";
import { applyWithModel } from "../src/builder/withers/model-budget.js";
import { asBuilderState } from "../src/builder/withers/_state.js";
import { ModelOptionError, errorContext } from "../src/errors.js";

const TRACE_DIR = mkdtempSync(join(tmpdir(), "ra-with-model-params-"));
const PRIOR_DIR = process.env.REACTIVE_AGENTS_TRACE_DIR;
const PRIOR_FLAG = process.env.REACTIVE_AGENTS_TRACE;
process.env.REACTIVE_AGENTS_TRACE_DIR = TRACE_DIR;
delete process.env.REACTIVE_AGENTS_TRACE;

afterAll(() => {
  // A test-unique model id plus this reset keep any capability row out of
  // later files in the same `bun test` process (default model "test-model").
  _resetProbedRegistryForTesting();
  if (PRIOR_DIR === undefined) delete process.env.REACTIVE_AGENTS_TRACE_DIR;
  else process.env.REACTIVE_AGENTS_TRACE_DIR = PRIOR_DIR;
  if (PRIOR_FLAG !== undefined) process.env.REACTIVE_AGENTS_TRACE = PRIOR_FLAG;
  rmSync(TRACE_DIR, { recursive: true, force: true });
});

const modelSlots = (builder: ReactiveAgentBuilder) => {
  const s = asBuilderState(builder);
  return {
    model: s._model,
    numCtx: s._numCtx,
    temperature: s._temperature,
    maxTokens: s._maxTokens,
    thinking: s._thinking,
  };
};

/** Run `fn`, return the `ModelOptionError` it threw (fails the test otherwise). */
const modelOptionErrorOf = (fn: () => unknown): ModelOptionError => {
  let caught: unknown;
  try {
    fn();
  } catch (e) {
    caught = e;
  }
  if (!isModelOptionError(caught)) throw new TypeError(`expected ModelOptionError, got ${String(caught)}`);
  return caught;
};

const isModelOptionError = (e: unknown): e is ModelOptionError =>
  typeof e === "object" && e !== null && "_tag" in e && e._tag === "ModelOptionError";

/** A JS caller with no type checking: any value reaches the wither. */
const untyped = (builder: ReactiveAgentBuilder, ...args: unknown[]): void =>
  Reflect.apply(applyWithModel, undefined, [builder, ...args]);

describe("withModel(modelId, params) — one code path with the object form", () => {
  it("resolves numCtx 8000 from .withModel(\"m\", { numCtx: 8000 })", () => {
    const builder = ReactiveAgents.create().withModel("gemma4:e4b", { numCtx: 8000 });
    expect(modelSlots(builder).model).toBe("gemma4:e4b");
    expect(modelSlots(builder).numCtx).toBe(8000);
    expect(builder.toConfig().numCtx).toBe(8000);
    expect(builder.toConfig().model).toBe("gemma4:e4b");
  });

  it("applies every ModelParams field, identical to the object form", () => {
    const params = { numCtx: 8000, temperature: 0.2, maxTokens: 512, thinking: false };
    const twoArg = new ReactiveAgentBuilder().withModel("gemma4:e4b", params);
    const object = new ReactiveAgentBuilder().withModel({ model: "gemma4:e4b", ...params });
    expect(modelSlots(twoArg)).toEqual({ model: "gemma4:e4b", ...params });
    expect(modelSlots(twoArg)).toEqual(modelSlots(object));
    expect(twoArg.toConfig()).toEqual(object.toConfig());
  });

  it("the string form alone and an empty params object set only the model id", () => {
    for (const builder of [
      new ReactiveAgentBuilder().withModel("m"),
      new ReactiveAgentBuilder().withModel("m", {}),
    ]) {
      expect(modelSlots(builder)).toEqual({
        model: "m",
        numCtx: undefined,
        temperature: undefined,
        maxTokens: undefined,
        thinking: undefined,
      });
    }
  });

  it("toConfig() -> fromConfig() round trip preserves numCtx", async () => {
    const config = ReactiveAgents.create()
      .withProvider("ollama")
      .withModel("gemma4:e4b", { numCtx: 8000, temperature: 0.3 })
      .toConfig();
    const restored = await ReactiveAgents.fromConfig(config);
    expect(restored.toConfig().numCtx).toBe(8000);
    expect(restored.toConfig().temperature).toBe(0.3);
    expect(restored.toConfig().model).toBe("gemma4:e4b");
  });

  it("run-started.config.builder records numCtx 8000", async () => {
    const agent = await ReactiveAgents.create()
      .withTestScenario([{ text: "FINAL ANSWER: ok" }])
      .withModel("seam-numctx-model", { numCtx: 8000 })
      .withReasoning({ defaultStrategy: "reactive" })
      .withMaxIterations(2)
      .build();
    const result = await agent.run("numCtx pin");
    await agent.dispose();
    const events = (await loadTrace(result.metadata.tracePath!)).events;
    const started = events.find((e) => e.kind === "run-started");
    expect(started?.kind).toBe("run-started");
    if (started?.kind !== "run-started") return;
    const cfg = started.config as { builder: Record<string, unknown> };
    expect(cfg.builder.numCtx).toBe(8000);
    expect(cfg.builder.model).toBe("seam-numctx-model");
  });
});

describe("withModel — wrong-shaped arguments fail loudly (no silent drop)", () => {
  it("a non-object params argument throws ModelOptionError naming it", () => {
    for (const bad of [8000, "8000", null, [8000], true]) {
      const err = modelOptionErrorOf(() => untyped(new ReactiveAgentBuilder(), "m", bad));
      expect(err.argument).toBe("params");
      expect(err.message).toContain("params");
    }
  });

  it("an unknown params key (num_ctx) throws and lists the accepted keys", () => {
    const err = modelOptionErrorOf(() => untyped(new ReactiveAgentBuilder(), "m", { num_ctx: 8000 }));
    expect(err.argument).toBe("params");
    expect(err.message).toContain("`num_ctx`");
    expect(err.message).toContain("numCtx");
  });

  it("`model` inside the two-argument params is rejected (one source for the id)", () => {
    const err = modelOptionErrorOf(() => untyped(new ReactiveAgentBuilder(), "m", { model: "other" }));
    expect(err.message).toContain("`model`");
  });

  it("an unknown key in the object form throws too", () => {
    const err = modelOptionErrorOf(() => untyped(new ReactiveAgentBuilder(), { model: "m", numctx: 8000 }));
    expect(err.argument).toBe("modelOrParams");
    expect(err.message).toContain("`numctx`");
  });

  it("a second argument after the object form throws", () => {
    const err = modelOptionErrorOf(() => untyped(new ReactiveAgentBuilder(), { model: "m" }, { numCtx: 8000 }));
    expect(err.argument).toBe("params");
  });

  it("a first argument that is neither string nor object throws", () => {
    for (const bad of [undefined, null, 42, ["m"]]) {
      const err = modelOptionErrorOf(() => untyped(new ReactiveAgentBuilder(), bad));
      expect(err.argument).toBe("modelOrParams");
    }
  });

  it("a rejected call leaves the builder untouched", () => {
    const builder = new ReactiveAgentBuilder().withModel("keep", { numCtx: 4096 });
    modelOptionErrorOf(() => untyped(builder, "replace", { numCtx: 8000, num_ctx: 1 }));
    expect(modelSlots(builder).model).toBe("keep");
    expect(modelSlots(builder).numCtx).toBe(4096);
  });

  it("errorContext gives a remediation for ModelOptionError", () => {
    const err = modelOptionErrorOf(() => untyped(new ReactiveAgentBuilder(), "m", 8000));
    expect(errorContext(err).suggestion).toContain(".withModel()");
  });

  it("the type surface rejects a non-object or unknown-key second argument", () => {
    const builder = new ReactiveAgentBuilder();
    // @ts-expect-error a number is not a params object
    expect(() => builder.withModel("m", 8000)).toThrow();
    // @ts-expect-error num_ctx is not a ModelParams field
    expect(() => builder.withModel("m", { num_ctx: 8000 })).toThrow();
    // @ts-expect-error the object form takes no second argument
    expect(() => builder.withModel({ model: "m" }, { numCtx: 1 })).toThrow();
  });
});
