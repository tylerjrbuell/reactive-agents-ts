// Run: bun test packages/reasoning/tests/kernel/recall-full-read.test.ts --timeout 20000
//
// R1 (owner trace 01M7SZPWPNY8, gemini-flash, umami task): a large result was
// compacted to `_tool_result_1`; the model called `recall(_tool_result_1,
// full: true)` and the recall OUTPUT went through the ordinary per-result
// compression, so it came back as "[recall result — compressed preview]" and was
// re-stored as `_tool_result_3`. The data never returned. A recall read now gets
// a budget bounded by the context window (`toolResultBudget`).
import { describe, expect, it } from "bun:test";
import { Effect, Layer } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { EventBusLive, rootContext } from "@reactive-agents/core";
import { withRunScope } from "@reactive-agents/core/internal/run-scope";
import { makeRecallHandler } from "@reactive-agents/tools";
import { mockToolServiceLayer } from "../../src/testing/tool-service-mock.js";
import { reactKernel } from "../../src/kernel/loop/react-kernel.js";
import { runPass } from "../../src/kernel/loop/run-pass.js";
import { toolResultBudget } from "../../src/kernel/capabilities/attend/tool-formatting.js";
import type { KernelInput, KernelRunOptions } from "../../src/kernel/state/kernel-state.js";

const SCHEMAS = [
  {
    name: "get_metrics",
    description: "fetch a metrics ranking",
    parameters: [{ name: "type", type: "string", required: true }],
  },
  {
    name: "recall",
    description: "read a stored key",
    parameters: [
      { name: "key", type: "string", required: true },
      { name: "full", type: "boolean", required: false },
    ],
  },
];

/** A JSON ranking large enough to overflow the inline cap (~9K chars). */
const ranking = (type: string): string =>
  JSON.stringify(
    { type, data: Array.from({ length: 160 }, (_, i) => ({ x: `/page-${type}-${i}`, y: 1000 - i })) },
    null,
    2,
  );

const toolLayer = mockToolServiceLayer({
  execute: (req) => {
    const r = req as { toolName: string; arguments?: Record<string, unknown> };
    if (r.toolName === "recall") {
      return makeRecallHandler()(r.arguments ?? {}).pipe(
        Effect.map((result) => ({ success: true, result })),
        Effect.orDie,
      );
    }
    return Effect.succeed({ success: true, result: ranking(String(r.arguments?.type ?? "path")) });
  },
  getTool: (name: string) =>
    Effect.succeed({ name, description: "test", parameters: [{ name: "type", type: "string", required: true }] }),
});

const input: KernelInput = {
  task: "Rank the pages by views and report the last-ranked page.",
  availableToolSchemas: SCHEMAS,
  metaTools: { recall: true },
  contextProfile: { tier: "frontier" },
  // In the owner trace the compaction stub surfaced the recall keys; no
  // compaction runs in this short script, so offer recall outright.
  calibration: { observationHandling: "uses-recall" },
} as KernelInput;

const opts: KernelRunOptions = {
  maxIterations: 6,
  strategy: "reactive",
  kernelType: "react",
  taskId: "recall-full-read",
  modelId: "gemini-flash-latest",
};

describe("R1 — a recall read returns stored evidence in full", () => {
  it("toolResultBudget widens only recall, bounded by the context window", () => {
    expect(toolResultBudget("get_metrics", 600, 128_000)).toBe(600);
    expect(toolResultBudget("recall", 600, 128_000)).toBe(128_000);
    expect(toolResultBudget("recall", 600, 2048)).toBe(2048);
    expect(toolResultBudget("recall", 4000, 2048)).toBe(4000);
    expect(toolResultBudget("recall", 600)).toBe(32_768);
  });

  it("compacted result → recall(full: true) puts the complete content in the model's thread", async () => {
    const turns = [
      { toolCall: { name: "get_metrics", args: { type: "path" } } },
      { toolCall: { name: "recall", args: { key: "_tool_result_1", full: true } } },
      { text: "The last-ranked page is /page-path-159." },
    ];
    const pass = await Effect.runPromise(
      withRunScope(rootContext("recall-full-read", "agent-r1"))(runPass(reactKernel, input, opts)).pipe(
        Effect.provide(Layer.mergeAll(TestLLMServiceLayer(turns), toolLayer, EventBusLive)),
      ),
    );

    // The fetch itself was compacted (the precondition of the owner trace).
    const fetchObs = pass.steps.find(
      (s) => s.type === "observation" && s.metadata?.observationResult?.toolName === "get_metrics",
    );
    expect(fetchObs?.content ?? "").not.toContain("/page-path-159");

    const recallObs = pass.steps.find(
      (s) => s.type === "observation" && s.metadata?.observationResult?.toolName === "recall",
    );
    expect(recallObs).toBeDefined();
    const recalled = recallObs?.content ?? "";
    expect(recalled).not.toContain("compressed preview");
    expect(recalled).toContain("/page-path-159");
    // Not re-stored as a new stored-result key.
    expect(recallObs?.metadata?.storedKey).toBeUndefined();

    // And the provider thread carries it, not only the step record.
    const toolMessages = pass.messages.filter((m) => m.role === "tool_result");
    expect(toolMessages.some((m) => JSON.stringify(m).includes("/page-path-159"))).toBe(true);
  }, 20000);
});
