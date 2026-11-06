// File: tests/strategies/plan-ref-normalize.test.ts
//
// H3 planner thinking-off (2026-11-06, wiki/Research/Harness-Reports/
// 2026-11-06-h3-planner-thinking-off): bonsai-2:27b planners wrote keyed refs
// like `{{from_step:s2:lowstock}}` in 2/3 runs. The from_step grammar only
// accepts `:summary` / `:full`, so dependency extraction and the fan-out split
// missed the ref, the resolver left it alone, and file-write wrote the literal
// token into low-stock.txt with ok:true (bonsai 3/3 -> 0/3).
//
// Fix: plan validation rewrites `{{from_step:sN:<key>}}` to the bare ref
// (planning/plan-refs.ts, guard `plan-ref-normalized`) in plan-execute and
// blueprint; the step-executor strips and the blueprint worker fails on ANY
// leftover `{{from_step:` token, so none reaches a tool as text.
//
// RED-ON-CUT:
//   - make `normalizeFromStepRefs` return `{ text, rewritten: [] }` and the pure,
//     guard and plan-execute / blueprint content tests go red (the literal
//     token is written);
//   - put back the old strip regex in step-executor.ts and the plan-execute
//     safety-net test goes red (`head {{from_step:last}} tail` is written);
//   - put back the old UNRESOLVED_REF_RE in blueprint/worker.ts and the
//     blueprint safety-net test goes red.
import { describe, it, expect } from "bun:test";
import { Effect, Layer, Ref } from "effect";
import { TestLLMService, LLMService } from "@reactive-agents/llm-provider";
import { ToolService, createToolsLayer } from "@reactive-agents/tools";
import { EventBus, EventBusLive, type AgentEvent } from "@reactive-agents/core";
import { executePlanExecute } from "../../src/strategies/plan-execute.js";
import { executeBlueprint } from "../../src/strategies/blueprint.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { provideTestEnvelope } from "../../src/kernel/envelope/run-envelope.js";
import { extractDependencies, hydratePlan, type LLMPlanStep } from "../../src/types/plan.js";
import { anyFromStepRe, normalizeFromStepRefs } from "../../src/assembly/ref-grammar.js";
import { normalizePlanRefs, PLAN_REF_NORMALIZED_GUARD } from "../../src/strategies/planning/plan-refs.js";
import { mockToolServiceLayer } from "../../src/testing/tool-service-mock.js";
import { augmentPlan, patchPlan } from "../../src/strategies/planning/plan-mutation.js";

const planOf = (steps: readonly LLMPlanStep[]) =>
  hydratePlan({ steps }, { taskId: "t", agentId: "a", goal: "Write the low-stock file", planMode: "linear" });

const write = (path: string, content: string): LLMPlanStep => ({
  title: `Write ${path}`, instruction: `write ${path}`, type: "tool_call", toolName: "write-note",
  toolArgs: { path, content },
});

describe("normalizeFromStepRefs (pure)", () => {
  it("rewrites a keyed ref to the bare ref and keeps grammar refs as they are", () => {
    expect(normalizeFromStepRefs("{{from_step:s2:lowstock}}")).toEqual({
      text: "{{from_step:s2}}",
      rewritten: ["{{from_step:s2:lowstock}}"],
    });
    expect(normalizeFromStepRefs("a {{from_step:s1:full}} b {{from_step:s2:summary}} c {{from_step:s3}}")).toEqual({
      text: "a {{from_step:s1:full}} b {{from_step:s2:summary}} c {{from_step:s3}}",
      rewritten: [],
    });
    expect(normalizeFromStepRefs("items: {{from_step:s4:items.low_stock}} done").text).toBe("items: {{from_step:s4}} done");
  });

  it("anyFromStepRe matches every from_step token, in grammar or not", () => {
    const text = "{{from_step:s1}} {{from_step:s2:full}} {{from_step:s3:lowstock}} {{from_step:last}} {{ from_step:s5 }}";
    expect(text.match(anyFromStepRe())).toHaveLength(5);
  });
});

describe("normalizePlanRefs (pure)", () => {
  it("rewrites keyed refs in tool args and instructions, so dependency extraction sees them", () => {
    const steps = planOf([
      { title: "Analyze", instruction: "list low-stock items", type: "analysis" },
      { ...write("low-stock.txt", "{{from_step:s1:lowstock}}"), instruction: "write {{from_step:s1:lowstock}} to the file" },
    ]).steps;
    expect(extractDependencies(steps[1]!).has("s1")).toBe(false);

    const { steps: out, normalized } = normalizePlanRefs(steps);
    expect(out[1]!.toolArgs?.content).toBe("{{from_step:s1}}");
    expect(out[1]!.instruction).toBe("write {{from_step:s1}} to the file");
    expect(extractDependencies(out[1]!).has("s1")).toBe(true);
    expect(normalized).toEqual([{ stepId: "s2", refs: ["{{from_step:s1:lowstock}}", "{{from_step:s1:lowstock}}"] }]);
  });

  it("returns the same steps when every ref is in grammar", () => {
    const steps = planOf([
      { title: "Analyze", instruction: "analyze", type: "analysis" },
      write("a.txt", "{{from_step:s1:full}}"),
    ]).steps;
    expect(normalizePlanRefs(steps)).toEqual({ steps, normalized: [] });
  });
});

// H3 plan-ref-normalize rerun (2026-11-06, wiki/Research/Harness-Reports/
// 2026-11-06-h3-plan-ref-normalize, bonsai run2 01M6R728BXFAF801MGDHA5N2H3):
// the planner wrote `content: "{{from_step:s2:summary}}"` for every file.
// :summary collapses whitespace and caps at 500 chars (types/plan.ts
// distillStepResult), so 'SKU-003\nSKU-008' was written as 'SKU-003 SKU-008'
// and `## Reorder` left the start of its line. Fix: a :summary ref that is the
// whole value of a file-content arg (the call names a literal file target) is
// rewritten to :full at plan validation. Search/query args keep :summary.
// RED-ON-CUT: drop the `toFull` rewrite in plan-refs.ts and these go red (the
// pure test keeps :summary; the integration test writes the flattened text).
describe(":summary into a whole file-content arg is rewritten to :full (pure)", () => {
  it("rewrites the content ref of a file-writing call; keeps query args and fragments", () => {
    const steps = planOf([
      { title: "Analyze", instruction: "list low-stock skus", type: "analysis" },
      write("low-stock.txt", "{{from_step:s1:summary}}"),
      write("notes.md", "Low stock: {{from_step:s1:summary}}"),
      { title: "Search", instruction: "search", type: "tool_call", toolName: "web-search", toolArgs: { query: "{{from_step:s1:summary}}" } },
    ]).steps;
    const { steps: out, normalized } = normalizePlanRefs(steps);
    expect(out[1]!.toolArgs?.content).toBe("{{from_step:s1:full}}");
    expect(out[2]!.toolArgs?.content).toBe("Low stock: {{from_step:s1:summary}}");
    expect(out[3]!.toolArgs?.query).toBe("{{from_step:s1:summary}}");
    expect(normalized).toEqual([{ stepId: "s2", refs: [], fullContent: ["content"] }]);
  });
});

/** Run `program` with an EventBus and collect its plan-ref-normalized guard events. */
const withGuardLog = async <A, E>(program: Effect.Effect<A, E, EventBus>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const events = yield* Ref.make<AgentEvent[]>([]);
      const bus = yield* EventBus;
      yield* bus.on("GuardFiredEmitted", (ev) =>
        ev._tag === "GuardFiredEmitted" && ev.guard === PLAN_REF_NORMALIZED_GUARD ? Ref.update(events, (xs) => [...xs, ev]) : Effect.void);
      const result = yield* program;
      return { result, guards: yield* Ref.get(events) };
    }).pipe(Effect.provide(EventBusLive)),
  );

const KEYED_PLAN = {
  steps: [
    { title: "Analyze", instruction: "list the low-stock items", type: "analysis" },
    write("low-stock.txt", "{{from_step:s1:lowstock}}"),
  ],
};

const writeNoteDef = {
  name: "write-note",
  description: "Write a note file",
  parameters: [
    { name: "path", type: "string" as const, description: "File path", required: true },
    { name: "content", type: "string" as const, description: "File content", required: true },
  ],
  riskLevel: "low" as const,
  timeoutMs: 5_000,
  requiresApproval: false,
  source: "function" as const,
};

/** Run plan-execute on `planJson` with a recording write-note tool. */
const runPlanExecute = async (planJson: string, turns: readonly { match?: string; text: string }[]) => {
  const llm = TestLLMService([{ match: "planning agent", text: planJson }, ...turns, { match: "GOAL:", text: "SATISFIED: done." }, { text: "Final answer." }]);
  const written: Record<string, unknown> = {};
  const program = Effect.gen(function* () {
    const tools = yield* ToolService;
    yield* tools.register(writeNoteDef, (args) => Effect.sync(() => { written[String(args.path)] = args.content; return "ok"; }));
    return yield* executePlanExecute({
      taskDescription: "Write the low-stock file",
      taskType: "files",
      memoryContext: "",
      availableTools: ["write-note"],
      config: defaultReasoningConfig,
    });
  });
  const { guards } = await withGuardLog(provideTestEnvelope(
    program.pipe(Effect.provide(Layer.merge(Layer.succeed(LLMService, LLMService.of(llm)), createToolsLayer()))),
  ));
  return { written, guards };
};

describe("plan-execute normalizes a keyed ref at plan validation (integration)", () => {
  it("writes the referenced step's output, never the literal token; one guard event", async () => {
    const { written, guards } = await runPlanExecute(JSON.stringify(KEYED_PLAN), [
      { match: "content of low-stock.txt", text: "widget-a, widget-b" },
    ]);
    expect(written).toEqual({ "low-stock.txt": "widget-a, widget-b" });
    expect(guards).toHaveLength(1);
    expect(guards[0]).toMatchObject({
      guard: PLAN_REF_NORMALIZED_GUARD,
      metadata: { normalized: [{ stepId: "s2", refs: ["{{from_step:s1:lowstock}}"] }] },
    });
  }, 30_000);

  it("a :summary file-content ref keeps the producer's lines (H3 bonsai run2 shape)", async () => {
    const plan = {
      steps: [
        { title: "Analyze", instruction: "find the low-stock skus and write the summary", type: "analysis" },
        write("low-stock.txt", "{{from_step:s1:summary}}"),
        write("summary.md", "{{from_step:s1:summary}}"),
      ],
    };
    const { written, guards } = await runPlanExecute(JSON.stringify(plan), [
      { match: "content of low-stock.txt", text: "SKU-003\nSKU-008\nSKU-012" },
      { match: "content of summary.md", text: "# Inventory\n\n## Reorder\nSKU-003" },
    ]);
    expect(written).toEqual({ "low-stock.txt": "SKU-003\nSKU-008\nSKU-012", "summary.md": "# Inventory\n\n## Reorder\nSKU-003" });
    expect(guards).toHaveLength(1);
    expect(guards[0]).toMatchObject({
      guard: PLAN_REF_NORMALIZED_GUARD,
      reason: expect.stringContaining("rewrote :summary to :full in 2 file-content arg(s) in step(s) s2, s3"),
      metadata: { normalized: [{ stepId: "s2", refs: [], fullContent: ["content"] }, { stepId: "s3", refs: [], fullContent: ["content"] }] },
    });
  }, 30_000);

  it("safety net: a from_step token outside the grammar never reaches a tool as text", async () => {
    const plan = { steps: [{ title: "Analyze", instruction: "analyze", type: "analysis" }, write("out.txt", "head {{from_step:last}} tail")] };
    const { written } = await runPlanExecute(JSON.stringify(plan), [{ text: "analysis done" }]);
    expect(String(written["out.txt"])).not.toContain("{{from_step");
  }, 30_000);
});

describe("replans normalize keyed refs and emit the same guard event (patchPlan, augmentPlan)", () => {
  // Simplicity audit item 12: replans rewrote keyed refs silently (no event).
  // RED-ON-CUT: call normalizePlanRefs(...).steps in plan-mutation.ts instead of
  // normalizeReplanRefs and both tests lose their guard event.
  const REPLAN = { steps: [write("low-stock.txt", "{{from_step:s1:lowstock}}")] };
  const llmLayer = Layer.succeed(LLMService, LLMService.of(TestLLMService([{ json: REPLAN }])));
  const base = planOf([{ title: "Analyze", instruction: "list low-stock items", type: "analysis" }]);

  it("patchPlan rewrites the ref and emits one plan-ref-normalized event", async () => {
    const { result, guards } = await withGuardLog(
      patchPlan(base, 0, { taskDescription: "Write the low-stock file" }, undefined, 0).pipe(Effect.provide(llmLayer)),
    );
    expect(result?.steps[0]?.toolArgs?.content).toBe("{{from_step:s1}}");
    expect(guards).toHaveLength(1);
    expect(guards[0]).toMatchObject({ guard: PLAN_REF_NORMALIZED_GUARD, taskId: "t" });
  }, 30_000);

  it("augmentPlan rewrites the ref and emits one plan-ref-normalized event", async () => {
    const { result, guards } = await withGuardLog(
      augmentPlan(base, "Write the low-stock file", "missing file", {}, undefined, 0).pipe(Effect.provide(llmLayer)),
    );
    expect(result?.steps[0]?.toolArgs?.content).toBe("{{from_step:s1}}");
    expect(guards).toHaveLength(1);
  }, 30_000);
});

/** Run blueprint on `plan` with a recording mock tool service. */
const runBlueprint = async (plan: unknown, turns: readonly { match?: string; text: string }[]) => {
  const written: Record<string, unknown> = {};
    const tools = mockToolServiceLayer({
      execute: (req: { toolName: string; arguments?: Record<string, unknown> }) =>
        Effect.sync(() => {
          written[String(req.arguments?.path)] = req.arguments?.content;
          return { success: true, result: "ok" };
        }),
      getTool: (name: string) => Effect.succeed({ name, description: "test tool", parameters: [] }),
      register: () => Effect.void,
      listTools: () => Effect.succeed([]),
      deregister: () => Effect.void,
    });
    const llm = TestLLMService([{ json: plan }, ...turns, { text: "Wrote the file." }]);
    const { guards } = await withGuardLog(provideTestEnvelope(
      executeBlueprint({
        taskDescription: "Write the low-stock file",
        taskType: "files",
        memoryContext: "",
        availableTools: ["write-note"],
        availableToolSchemas: [{ name: "write-note", description: "write", parameters: [] }],
        config: defaultReasoningConfig,
      }).pipe(Effect.provide(Layer.mergeAll(tools, Layer.succeed(LLMService, LLMService.of(llm))))),
    ));
  return { written, guards };
};

describe("blueprint normalizes the same keyed ref (integration)", () => {
  it("writes the referenced step's output and emits one guard event", async () => {
    const { written, guards } = await runBlueprint(KEYED_PLAN, [
      { match: "content of low-stock.txt", text: "widget-a, widget-b" },
    ]);
    expect(written).toEqual({ "low-stock.txt": "widget-a, widget-b" });
    expect(guards).toHaveLength(1);
  }, 30_000);

  it("safety net: the worker fails a step whose args keep a from_step token, writing nothing", async () => {
    const plan = { steps: [{ title: "Analyze", instruction: "analyze", type: "analysis" }, write("out.txt", "{{from_step:s1:full}} {{from_step:last}}")] };
    const { written } = await runBlueprint(plan, [{ text: "analysis done" }]);
    expect(written).toEqual({});
  }, 30_000);
});
