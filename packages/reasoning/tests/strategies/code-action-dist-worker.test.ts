// Run: bunx turbo run build --filter=@reactive-agents/reasoning && bun test packages/reasoning/tests/strategies/code-action-dist-worker.test.ts --timeout 20000
//
// Owner report 2026-11-20 (Cortex on a fresh machine, published 0.19.0): every
// Code Action run failed with `ModuleNotFound resolving ".../@reactive-agents/
// reasoning/dist/sandbox-worker.ts" (entry point)`. sandbox.ts spawned
// `new URL("./sandbox-worker.ts", import.meta.url)`; tsup bundled sandbox.ts into
// dist/index.js but the worker was not a build entry, so dist had no worker and the
// URL named a .ts file. Repo tests import src, so they never saw it.
//
// This file imports the BUILT package (dist/, the files npm users get), never src,
// and runs a code-action program through the public StrategyRegistry to completion.
// It needs a current build (CI builds before `bun test`; locally run the build above).
//
// RED-ON-CUT: drop the `sandbox-worker` entry from tsup.config.ts (no worker in
// dist; both tests fail) or make sandbox.ts `sandboxWorkerUrl` always name
// "./sandbox-worker.ts" (the run test fails), then rebuild.
import { describe, it, expect } from "bun:test";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Effect, Layer } from "effect";
import type { ToolService } from "@reactive-agents/tools";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import {
  StrategyRegistry,
  StrategyRegistryLive,
  defaultReasoningConfig,
  provideTestEnvelope,
  buildRunEnvelope,
} from "../../dist/index.js";
import { mockToolServiceLayer } from "../../dist/testing/index.js";

const distFile = (name: string) => fileURLToPath(new URL(`../../dist/${name}`, import.meta.url));

describe("code-action from the built dist (npm install layout)", () => {
  it("dist ships the sandbox worker as JavaScript", () => {
    expect(existsSync(distFile("sandbox-worker.js"))).toBe(true);
  });

  it("a code-action program runs in the sandbox to completion from dist", async () => {
    const tools = mockToolServiceLayer({
      execute: () => Effect.succeed({ success: true, result: "unused" }),
      getTool: (name: string) => Effect.succeed({ name, description: "t", parameters: [] }),
      register: () => Effect.void,
      listTools: () => Effect.succeed([]),
      deregister: () => Effect.void,
    }) as Layer.Layer<ToolService>;
    const llm = TestLLMServiceLayer([
      { text: "```javascript\n(async () => { return { answer: 6 * 7 }; })()\n```" },
      // The answer-writing call over a structured result answers empty, so the
      // run keeps the program's raw result.
      { match: "raw data gathered by tools", text: "" },
    ]);
    const program = Effect.gen(function* () {
      const registry = yield* StrategyRegistry;
      const codeAction = yield* registry.get("code-action");
      return yield* codeAction({
        taskDescription: "Compute six times seven",
        taskType: "simple",
        memoryContext: "",
        availableTools: [],
        availableToolSchemas: [],
        config: defaultReasoningConfig,
      });
    }).pipe(Effect.provide(Layer.mergeAll(StrategyRegistryLive, llm, tools)));
    const result = await Effect.runPromise(provideTestEnvelope(program, buildRunEnvelope({})));
    // Status and error together, so a red run names the sandbox failure.
    expect({ status: result.status, error: result.error }).toEqual({ status: "completed", error: undefined });
    expect(String(result.output)).toContain("42");
  }, 20000);
});
