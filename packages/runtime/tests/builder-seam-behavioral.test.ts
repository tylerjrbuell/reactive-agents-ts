/**
 * Builder→runtime seam — BEHAVIORAL contract tests (DEBT-REGISTER B3, Wave 2).
 *
 * The boundary: every builder field crosses to the runtime via
 * `self as unknown as BuilderRuntimeStateView`
 * (`builder.ts:2442` → `runtime-construction.ts`). That structural cast will
 * NOT catch a deleted wiring line — the `_*` field still exists on the view, so
 * a `createRuntime({ … })` argument can be dropped and the whole suite stays
 * green. The pre-existing wither tests assert PRIVATE `_*` fields (or the
 * serialized `toConfig()` shape), never the BUILT AGENT's behavior, so those
 * withers were "SILENT": wired by luck, killable by a refactor invisibly.
 *
 * Each test here builds an agent WITH vs WITHOUT the wither and asserts an
 * OBSERVABLE difference in what the agent DOES — a captured LLM request, the
 * AgentResult, a termination reason, a structured object. Every test is
 * RED-ON-CUT: deleting/negating the wither's wiring line (noted per-test) makes
 * the assertion fail. These are NOT `builder._enableX === true` setter asserts.
 *
 * Two harnesses:
 *   A. INLINE + capturing LLMService (via `.withLayers()`), provider "anthropic"
 *      with no `.withReasoning()` — the injected layer shadows the built-in
 *      LLMService on the inline path, so we observe the exact CompletionRequest
 *      (system message, tool schemas) the harness built. No network call: the
 *      capturing layer returns a deterministic "FINAL ANSWER" so the agent
 *      terminates in one step.
 *   B. REASONING + `.withTestScenario()` — the deterministic test provider drives
 *      the reasoning kernel over scripted turns; we observe the AgentResult
 *      (terminatedBy, strategyUsed, output, structured object).
 */
import { describe, it, expect } from "bun:test";
import { Effect, Layer, Schema } from "effect";
import { ReactiveAgents } from "../src/builder.js";
import { LLMService, TestLLMService } from "@reactive-agents/llm-provider";

type Req = import("@reactive-agents/llm-provider").CompletionRequest;

// ─── Harness A: inline path, capturing LLMService ────────────────────────────

function capturingLayer(captured: Req[]): Layer.Layer<LLMService> {
  const base = TestLLMService([{ text: "FINAL ANSWER: done" }]);
  return Layer.succeed(
    LLMService,
    LLMService.of({
      ...base,
      complete: (r) => {
        captured.push(r);
        return base.complete(r);
      },
      stream: (r) => {
        captured.push(r);
        return base.stream(r);
      },
    }),
  );
}

/** Build+run on the INLINE path with a capturing LLMService; return the first request + result. */
async function inlineCapture(
  apply: (b: ReturnType<typeof ReactiveAgents.create>) => ReturnType<typeof ReactiveAgents.create>,
): Promise<{ req: Req | undefined; result: Awaited<ReturnType<Awaited<ReturnType<ReturnType<typeof ReactiveAgents.create>["build"]>>["run"]>> }> {
  const captured: Req[] = [];
  const agent = await apply(
    ReactiveAgents.create().withName("seam").withProvider("anthropic").withModel("claude-sonnet-4-6"),
  )
    .withLayers(capturingLayer(captured))
    .build();
  try {
    const result = await agent.run("What is 2 + 2?");
    return { req: captured[0], result };
  } finally {
    await agent.dispose();
  }
}

// A low-risk custom tool used to observe the tool surface / drive tool loops.
const loopTool = {
  tools: [
    {
      definition: {
        name: "seam_marker_tool",
        description: "seam behavioral marker tool",
        parameters: [],
        riskLevel: "low" as const,
        timeoutMs: 5_000,
        requiresApproval: false,
        source: "function" as const,
      },
      handler: () => Effect.succeed("keep going"),
    },
  ],
};

describe("builder→runtime seam — behavioral (RED-ON-CUT)", () => {
  // 1. withPersona — wiring: buildSubAgentSystemPrompt(self._persona, …) in
  //    builder.ts. Cut the persona arg → "Role: …" disappears from the system
  //    message → RED.
  it("withPersona() injects the role into the system message", async () => {
    const withPersona = await inlineCapture((b) =>
      b.withPersona({ role: "SEAM_PIRATE_ROLE", tone: "gruff" }),
    );
    const without = await inlineCapture((b) => b);
    const sys = (r: Req | undefined) =>
      typeof r?.messages?.[0]?.content === "string" ? (r.messages[0].content as string) : "";
    expect(sys(withPersona.req)).toContain("SEAM_PIRATE_ROLE");
    expect(sys(without.req)).not.toContain("SEAM_PIRATE_ROLE");
  });

  // 2. withTaskContext — wiring: `taskContext: state._taskContext` in
  //    runtime-construction.ts. Cut it → the grounding block never reaches the
  //    system message → RED.
  it("withTaskContext() grounds the system message with the provided keys", async () => {
    const withCtx = await inlineCapture((b) => b.withTaskContext({ SEAM_TASK_KEY: "seam-ctx-val" }));
    const without = await inlineCapture((b) => b);
    const sys = (r: Req | undefined) =>
      typeof r?.messages?.[0]?.content === "string" ? (r.messages[0].content as string) : "";
    expect(sys(withCtx.req)).toContain("SEAM_TASK_KEY");
    expect(sys(without.req)).not.toContain("SEAM_TASK_KEY");
  });

  // 3. withTools — wiring: `enableTools`/`builtins`/tools → createRuntime. Cut it
  //    → the model is offered NO tool schemas (request.tools undefined) → RED.
  it("withTools() offers the registered tool schema to the model", async () => {
    const withTools = await inlineCapture((b) => b.withTools(loopTool));
    const without = await inlineCapture((b) => b);
    const names = (r: Req | undefined) => (r?.tools ?? []).map((t) => t.name);
    expect(names(withTools.req)).toContain("seam_marker_tool");
    expect(without.req?.tools ?? []).toHaveLength(0);
  });

  // 4. withReasoning({ defaultStrategy }) — wiring: `reasoningOptions:
  //    state._reasoningOptions`. Cut it → the kernel falls back to the default
  //    strategy and `metadata.strategyUsed` no longer reports "plan-execute" → RED.
  it("withReasoning({ defaultStrategy }) selects the requested strategy", async () => {
    const agent = await ReactiveAgents.create()
      .withName("seam")
      .withTestScenario([{ text: "FINAL ANSWER: 4" }])
      .withReasoning({ defaultStrategy: "plan-execute" })
      .build();
    try {
      const r = await agent.run("q");
      expect(r.metadata.strategyUsed).toBe("plan-execute");
    } finally {
      await agent.dispose();
    }
  });

  // 5. withMaxIterations — wiring: `maxIterations: state._maxIterations`. With an
  //    always-tool-calling scenario the loop can only stop by hitting the cap.
  //    Cut the wiring → the (much larger) default cap applies → the run takes
  //    many more steps, so the tight upper bound goes RED.
  it("withMaxIterations(2) caps the loop (terminatedBy max_iterations, few steps)", async () => {
    const agent = await ReactiveAgents.create()
      .withName("seam")
      .withTestScenario([{ toolCalls: [{ name: "seam_marker_tool", arguments: {} }] }])
      .withReasoning({ defaultStrategy: "reactive" })
      .withMaxIterations(2)
      .withTools(loopTool)
      .build();
    try {
      const r = await agent.run("loop forever");
      expect(r.terminatedBy).toBe("max_iterations");
      // 2 iterations → a small, bounded step count. The default cap (≥10) would
      // blow past this bound if the wiring were cut.
      expect(r.metadata.stepsCount).toBeLessThanOrEqual(6);
    } finally {
      await agent.dispose();
    }
  });

  // 6. withOutputValidator — wiring: `outputValidator: state._outputValidator`.
  //    The first answer fails validation; the harness re-prompts and accepts the
  //    second. Cut the wiring → the first (invalid) answer is returned unchecked
  //    → RED.
  it("withOutputValidator() rejects the first answer and returns the valid retry", async () => {
    const build = () =>
      ReactiveAgents.create()
        .withName("seam")
        .withTestScenario([
          { text: "FINAL ANSWER: nope" },
          { text: "FINAL ANSWER: has SEAMTOKEN inside" },
        ])
        .withReasoning({ defaultStrategy: "reactive", maxIterations: 5 });

    const validated = await build()
      .withOutputValidator((o) => ({ valid: o.includes("SEAMTOKEN"), feedback: "must contain SEAMTOKEN" }), {
        maxRetries: 2,
      })
      .build();
    const unvalidated = await build().build();
    try {
      const rv = await validated.run("q");
      const ru = await unvalidated.run("q");
      expect(rv.output).toContain("SEAMTOKEN");
      expect(ru.output).toContain("nope");
      expect(ru.output).not.toContain("SEAMTOKEN");
    } finally {
      await validated.dispose();
      await unvalidated.dispose();
    }
  });

  // 7. withOutputSchema — wiring: `_outputSchemaConfig` → structured-output rail
  //    in builder.ts buildEffect. Cut it → `result.object` is never populated → RED.
  it("withOutputSchema() populates result.object with the typed value", async () => {
    const schema = Schema.Struct({ answer: Schema.String });
    const typed = await ReactiveAgents.create()
      .withName("seam")
      .withTestScenario([{ json: { answer: "forty-two" } }])
      .withOutputSchema(schema)
      .build();
    const plain = await ReactiveAgents.create()
      .withName("seam")
      .withTestScenario([{ json: { answer: "forty-two" } }])
      .build();
    try {
      const rt = await typed.run("q");
      const rp = await plain.run("q");
      expect(rt.object).toEqual({ answer: "forty-two" });
      expect(rp.object).toBeUndefined();
    } finally {
      await typed.dispose();
      await plain.dispose();
    }
  });
});
