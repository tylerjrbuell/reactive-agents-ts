// Run: bun test packages/runtime/tests/seam-tool-builder-entry.test.ts --timeout 20000
//
// Seam pin: `toolBuilderToEntry` (builder/withers/tools.ts) runs the
// ToolBuilder handler the way `defineTool` does. An Effect-returning handler
// (what the docs and demos write) must yield the Effect's VALUE as the tool
// result. Before 2026-11-17 the handler result was wrapped in
// `Effect.succeed`, so the tool returned the Effect object itself and the
// model saw an object dump instead of "42".
import { describe, it, expect } from "bun:test";
import { Effect, Exit } from "effect";
import { ToolBuilder } from "@reactive-agents/tools";
import { ReactiveAgents, toolBuilderToEntry } from "../src/index.js";

type Step = { readonly type: string; readonly content: string };

const observationsOf = (metadata: unknown): readonly Step[] =>
  ((metadata as { reasoningSteps?: readonly Step[] }).reasoningSteps ?? []).filter(
    (s) => s.type === "observation",
  );

const answerTool = (handler: (args: Record<string, unknown>) => unknown) =>
  toolBuilderToEntry(
    ToolBuilder.create("answer-tool")
      .description("Return the answer")
      .param("q", "string", "Question", { required: true })
      .handler(handler),
  );

describe("toolBuilderToEntry — handler result normalization", () => {
  it("an Effect-returning handler yields its value as the tool observation", async () => {
    const agent = await ReactiveAgents.create()
      .withTestScenario([
        { toolCall: { id: "t1", name: "answer-tool", args: { q: "life" } } },
        { text: "FINAL ANSWER: 42" },
      ])
      .withTools({ tools: [answerTool(() => Effect.succeed("42"))] })
      .build();
    try {
      const r = await agent.run("Use answer-tool to get the answer.");
      const obs = observationsOf(r.metadata);
      const toolObs = obs.find((s) => s.content.includes("42"));
      expect(toolObs).toBeDefined();
      // Pre-fix the observation was `{"_id":"Exit","_tag":"Success","value":"42"}`.
      expect(obs.some((s) => s.content.includes("_id") || s.content.includes("[object Object]"))).toBe(false);
    } finally {
      await agent.dispose();
    }
  }, 20000);

  it("unwraps Effect, Promise and plain returns to the same value", async () => {
    for (const out of [Effect.succeed("42"), Promise.resolve("42"), "42"]) {
      const entry = answerTool(() => out);
      expect(await Effect.runPromise(entry.handler({ q: "x" }))).toBe("42");
    }
  });

  it("a failing Effect, rejected Promise or throwing handler fails the Effect, not the caller", async () => {
    const handlers: ReadonlyArray<(args: Record<string, unknown>) => unknown> = [
      () => Effect.fail("boom"),
      () => Promise.reject("boom"),
      () => {
        throw "boom";
      },
    ];
    for (const h of handlers) {
      const exit = await Effect.runPromiseExit(answerTool(h).handler({ q: "x" }));
      expect(Exit.isFailure(exit)).toBe(true);
    }
  });
});
