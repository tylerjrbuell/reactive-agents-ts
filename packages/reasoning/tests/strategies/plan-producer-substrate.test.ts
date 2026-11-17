// File: tests/strategies/plan-producer-substrate.test.ts
//
// The plan-producer substrate (owner traces 01M7KQJFSXG9ZYG5J8K5R3NDQJ /
// 01M7KQK1SPSYVWT2X0B4NP41D0: a planner that baked a 2024 check-in date on a
// 2026 run, ran 1 of 5 steps and still finished success). Zero-token: pure
// policy modules, then scripted strategy runs.
//   1. one producer context (posture, date, effects, interaction) every planner reads;
//   2. plan-time argument validation, ungrounded arguments deferred to execute time;
//   3. the completion invariant: no `completed` with plan steps left open;
//   4. solve evidence chosen by step relevance within a budget, recorded on the trace.
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { LLMService, TestLLMService, type TestTurn } from "@reactive-agents/llm-provider";
import { EventBus, EventBusLive } from "@reactive-agents/core";
import { mockToolServiceLayer } from "../../src/testing/tool-service-mock.js";
import { executeBlueprint } from "../../src/strategies/blueprint.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { provideTestEnvelope } from "../../src/kernel/envelope/run-envelope.js";
import type { ToolSchema } from "../../src/kernel/capabilities/attend/tool-formatting.js";
import type { Plan, PlanStep } from "../../src/types/plan.js";
import { buildPlanProducerContext, renderCatalog, renderPlanProducerContext, PLAN_PRODUCER_POSTURE } from "../../src/kernel/policy/plan-producer-context.js";
import { goalGroundsDate, groundPlanArgs, resolveRelativeDate } from "../../src/kernel/policy/plan-args.js";
import { settlePlan, settlePlanSteps, unrunStepsFeedback } from "../../src/kernel/policy/plan-completion.js";
import { buildPlanGenerationPrompt, buildPatchPrompt, buildAugmentPrompt } from "../../src/strategies/planning/plan-prompts.js";
import { applyPlanInvariant, runStrategy } from "../../src/strategies/substrate/strategy-run.js";
import { finishOpenSteps } from "../../src/strategies/blueprint/finish-open.js";
import { resolveStrategyServices } from "../../src/kernel/utils/service-utils.js";
import { MIN_CLIPPED_CHARS, selectSolveEvidence } from "../../src/strategies/planning/solve-evidence.js";
import { obtainPlan } from "../../src/strategies/planning/input-plan.js";

const TODAY = "2026-11-16";
const NOW = new Date("2026-11-16T15:00:00Z");

const availability: ToolSchema = {
  name: "availability",
  description: "Check a listing's availability",
  parameters: [
    { name: "listing", type: "string", description: "Listing id", required: true },
    { name: "checkin", type: "string", description: "Check-in date (YYYY-MM-DD)", required: true },
  ],
  effect: "read",
};
const send: ToolSchema = { name: "send-note", description: "Send a note", parameters: [{ name: "text", type: "string", required: true }], effect: "write" };
const details: ToolSchema = { name: "listing_details", description: "Get a listing", parameters: [{ name: "listing", type: "string", required: true }], effect: "read" };

const step = (over: Partial<PlanStep> & Pick<PlanStep, "id" | "type">): PlanStep => ({
  seq: Number(over.id.slice(1)),
  title: over.id,
  instruction: `do ${over.id}`,
  status: "pending",
  retries: 0,
  tokensUsed: 0,
  ...over,
});
const planOf = (steps: PlanStep[]) => ({ steps });

describe("plan producer context", () => {
  it("carries the posture, the env date, the effects and what the planner may ask or look up", () => {
    const ctx = buildPlanProducerContext({ schemas: [availability, send], now: NOW, timeZone: "UTC" });
    expect(ctx.posture).toBe(PLAN_PRODUCER_POSTURE);
    expect(ctx.today).toBe(TODAY);
    expect(ctx.tools.map((t) => [t.name, t.effect])).toEqual([["availability", "read"], ["send-note", "write"]]);
    const text = renderPlanProducerContext(ctx);
    expect(text).toContain(`Today is ${TODAY} (Monday), timezone UTC`);
    expect(text).toContain("[r] tools look something up");
    expect(text).not.toContain("ask the user");
    const asking = buildPlanProducerContext({ schemas: [availability], now: NOW, timeZone: "UTC", ask: true, reconTools: [availability] });
    expect(renderPlanProducerContext(asking)).toContain("ask the user a question or call the read-only tools");
  });

  it("says nothing about dates when no tool takes one, and nothing at all when nothing applies", () => {
    const plain: ToolSchema = { name: "add", description: "Add", parameters: [{ name: "a", type: "number", required: true }] };
    const ctx = buildPlanProducerContext({ schemas: [plain], now: NOW, timeZone: "UTC" });
    expect(ctx.dateArgs).toBe(false);
    expect(renderPlanProducerContext(ctx)).toBe("");
  });

  it("every producer prompt (generate, patch, augment) is built from it", () => {
    const ctx = buildPlanProducerContext({ schemas: [availability, send], now: NOW, timeZone: "UTC" });
    const generate = buildPlanGenerationPrompt({ goal: "g", tools: [...ctx.tools], context: ctx, pastPatterns: [], modelTier: "frontier" });
    expect(generate).toContain(PLAN_PRODUCER_POSTURE);
    expect(generate).toContain(`Today is ${TODAY}`);
    expect(generate).toContain("- availability(listing, checkin) [r]\n");
    expect(generate).toContain("- send-note(text) [w]");
    const patch = buildPatchPrompt("g", [], [...ctx.tools], undefined, ctx);
    const augment = buildAugmentPrompt({ goal: "g", completedSteps: [], reflectionFeedback: "f", tools: [...ctx.tools], context: ctx });
    for (const p of [patch, augment]) {
      expect(p).toContain(PLAN_PRODUCER_POSTURE);
      expect(p).toContain(`Today is ${TODAY}`);
      expect(p).toContain("- availability(listing, checkin) [r]");
    }
  });
});

describe("the dense catalog renderer", () => {
  it("one line per tool: required first, optional as name?, effect mark, description only when the name does not say it, a param note only with an example", () => {
    const tools = buildPlanProducerContext({
      schemas: [
        { name: "add", description: "Add two numbers together", parameters: [{ name: "a", type: "number", required: true }, { name: "b", type: "number", required: true }] },
        { name: "gh-cli", description: "Run any GitHub CLI command; pass the subcommand and flags as command.", effect: "write",
          parameters: [{ name: "limit", type: "number", required: false }, { name: "command", type: "string", required: true, description: 'e.g. "pr list --state open"' }] },
      ],
      now: NOW,
    }).tools;
    expect(renderCatalog(tools)).toBe(
      "- add(a, b)\n- gh-cli(command, limit?) [w]: Run any GitHub CLI command; pass the subcommand and flags as command.\n    command: e.g. \"pr list --state open\"",
    );
  });
});

describe("plan-time argument validation", () => {
  const grounding = { goal: "Check availability for listing L-9", today: TODAY };

  it("defers an ISO date the goal does not give (the baked 2024 check-in) to execute time", () => {
    const plan = planOf([step({ id: "s1", type: "tool_call", toolName: "availability", toolArgs: { listing: "L-9", checkin: "2024-11-21" } })]);
    const findings = groundPlanArgs(plan, [availability], grounding);
    expect(findings).toEqual([expect.objectContaining({ stepId: "s1", kind: "ungrounded-literal", arg: "checkin" })]);
    const s = plan.steps[0]!;
    expect(s.type).toBe("composite");
    expect(s.toolHints).toEqual(["availability"]);
    expect(s.toolArgs).toBeUndefined();
    expect(s.instruction).toContain("supply checkin from the goal and today's date (2026-11-16)");
    expect(s.instruction).toContain('listing = "L-9"');
  });

  it("keeps a date the goal gives (verbatim, or month and day in the current or next year)", () => {
    expect(goalGroundsDate("stay from 2026-12-01", "2026-12-01", TODAY)).toBe(true);
    expect(goalGroundsDate("arriving Nov 21", "2026-11-21", TODAY)).toBe(true);
    expect(goalGroundsDate("arriving 21st of November", "2026-11-21", TODAY)).toBe(true);
    expect(goalGroundsDate("arriving Nov 21", "2024-11-21", TODAY)).toBe(false);
    expect(goalGroundsDate("arriving soon", "2026-11-21", TODAY)).toBe(false);
    const plan = planOf([step({ id: "s1", type: "tool_call", toolName: "availability", toolArgs: { listing: "L-9", checkin: "2026-11-21" } })]);
    expect(groundPlanArgs(plan, [availability], { goal: "arriving Nov 21 at L-9", today: TODAY })).toEqual([]);
    expect(plan.steps[0]!.type).toBe("tool_call");
  });

  it("resolves a relative phrase the goal used against the env date; an unused one is deferred", () => {
    expect(resolveRelativeDate("tomorrow", TODAY)).toBe("2026-11-17");
    expect(resolveRelativeDate("in 2 weeks", TODAY)).toBe("2026-11-30");
    expect(resolveRelativeDate("3 days ago", TODAY)).toBe("2026-11-13");
    const used = planOf([step({ id: "s1", type: "tool_call", toolName: "availability", toolArgs: { listing: "L-9", checkin: "tomorrow" } })]);
    expect(groundPlanArgs(used, [availability], { goal: "L-9 for tomorrow", today: TODAY })).toEqual([]);
    expect(used.steps[0]!.toolArgs).toEqual({ listing: "L-9", checkin: "2026-11-17" });
    const invented = planOf([step({ id: "s1", type: "tool_call", toolName: "availability", toolArgs: { listing: "L-9", checkin: "tomorrow" } })]);
    expect(groundPlanArgs(invented, [availability], grounding).map((f) => f.kind)).toEqual(["ungrounded-literal"]);
    expect(invented.steps[0]!.type).toBe("composite");
  });

  it("reports an unknown tool and a missing required argument; a from_step reference satisfies one", () => {
    const plan = planOf([
      step({ id: "s1", type: "tool_call", toolName: "nope", toolArgs: {} }),
      step({ id: "s2", type: "tool_call", toolName: "listing_details", toolArgs: {} }),
      step({ id: "s3", type: "tool_call", toolName: "listing_details", toolArgs: { listing: "{{from_step:s1}}" }, dependsOn: ["s1"] }),
    ]);
    const findings = groundPlanArgs(plan, [details], grounding);
    expect(findings.map((f) => [f.stepId, f.kind])).toEqual([["s1", "unknown-tool"], ["s2", "missing-required"]]);
    expect(plan.steps.map((s) => s.type)).toEqual(["tool_call", "composite", "tool_call"]);
  });

  it("a tool named on an analysis step makes it a composite step scoped to that tool", () => {
    const plan = planOf([step({ id: "s1", type: "analysis", toolName: "listing_details" })]);
    expect(groundPlanArgs(plan, [details], grounding).map((f) => f.kind)).toEqual(["tool-on-analysis"]);
    expect(plan.steps[0]).toMatchObject({ type: "composite", toolHints: ["listing_details"] });
  });

  it("obtainPlan validates a generated plan against the env date and hands back the shared context", async () => {
    const plan = { steps: [{ title: "Check", instruction: "check it", type: "tool_call", toolName: "availability", toolArgs: { listing: "L-9", checkin: "2024-11-21" } }] };
    const prompts: string[] = [];
    const inner = TestLLMService([{ json: plan }]);
    const llm = Layer.succeed(LLMService, LLMService.of({ ...inner, completeStructured: (req) => { prompts.push(JSON.stringify(req.messages)); return inner.completeStructured(req); } }));
    const got = await Effect.runPromise(
      obtainPlan({ input: { availableToolSchemas: [availability] }, goal: "Check availability for L-9", taskId: "t", agentId: "a", planMode: "dag", strategy: "blueprint", persona: "p", defaultTemperature: 0.4, pastPatterns: [], run: { account: () => undefined } }).pipe(Effect.provide(llm)),
    );
    expect(prompts[0]).toContain("Today is ");
    expect(prompts[0]).toContain(got.context.today);
    expect(got.plan.steps[0]!.type).toBe("composite");
    expect(got.context.tools.map((t) => t.name)).toEqual(["availability"]);
  });

  it("a caller-supplied plan keeps its dates but still has a missing required argument deferred", async () => {
    const supplied: Plan = { id: "p", taskId: "t", agentId: "a", goal: "g", mode: "dag", status: "active", version: 1, createdAt: "", updatedAt: "", totalTokens: 0, totalCost: 0, steps: [
      step({ id: "s1", type: "tool_call", toolName: "availability", toolArgs: { listing: "L-9", checkin: "2024-11-21" } }),
      step({ id: "s2", type: "tool_call", toolName: "listing_details", toolArgs: {} }),
    ] };
    const got = await Effect.runPromise(
      obtainPlan({ input: { plan: supplied, availableToolSchemas: [availability, details] }, goal: "g", taskId: "t", agentId: "a", planMode: "dag", strategy: "blueprint", persona: "p", defaultTemperature: 0.4, pastPatterns: [], run: { account: () => undefined } }).pipe(Effect.provide(Layer.succeed(LLMService, LLMService.of(TestLLMService([]))))),
    );
    expect(got.plan.steps.map((s) => s.type)).toEqual(["tool_call", "composite"]);
  });
});

describe("plan completion invariant", () => {
  it("each step ends done, skipped or failed; pending and in-progress are open", () => {
    const s = settlePlan([
      step({ id: "s1", type: "tool_call", status: "completed" }),
      step({ id: "s2", type: "tool_call", status: "skipped" }),
      step({ id: "s3", type: "tool_call", status: "failed" }),
      step({ id: "s4", type: "composite", status: "pending" }),
      step({ id: "s5", type: "tool_call", status: "in_progress" }),
    ]);
    expect(s.steps.map((e) => e.ending)).toEqual(["done", "skipped", "failed"]);
    expect(s.open.map((o) => o.id)).toEqual(["s4", "s5"]);
    expect(unrunStepsFeedback([step({ id: "s4", type: "composite" })])).toContain("s4");
    expect(unrunStepsFeedback([step({ id: "s1", type: "tool_call", status: "completed" })])).toBeUndefined();
  });

  it("only a pure analysis step finishes by synthesis; a tool or composite step never does", () => {
    const steps = [
      step({ id: "s1", type: "analysis" }),
      step({ id: "s2", type: "analysis", toolName: "listing_details" }),
      step({ id: "s3", type: "composite", toolHints: ["availability"] }),
      step({ id: "s4", type: "tool_call", toolName: "availability" }),
    ];
    expect(settlePlanSteps(steps, true).map((s) => s.status)).toEqual(["completed", "pending", "pending", "pending"]);
    expect(settlePlanSteps(steps, false).map((s) => s.status)).toEqual(["pending", "pending", "pending", "pending"]);
  });

  it("the terminal caps a completed run with open steps at partial, with the signal's warning, and records every ending", () => {
    const open = applyPlanInvariant({ _tag: "Result", output: "answer", status: "completed", plan: [step({ id: "s1", type: "tool_call", status: "completed" }), step({ id: "s2", type: "composite" })] });
    expect(open.open.map((s) => s.id)).toEqual(["s2"]);
    expect(open.end.status).toBe("partial");
    expect(open.end.outcome).toMatchObject({ _tag: "Unverified", warning: expect.stringContaining("s2") });
    expect(open.end.extraMetadata).toMatchObject({ planSteps: [{ id: "s1", ending: "done" }], planIncomplete: { open: ["s2"] } });
    const done = applyPlanInvariant({ _tag: "Result", output: "answer", status: "completed", plan: [step({ id: "s1", type: "tool_call", status: "completed" })] });
    expect(done.open).toEqual([]);
    expect(done.end.status).toBe("completed");
    expect(done.end.extraMetadata).toMatchObject({ planSteps: [{ id: "s1", ending: "done" }] });
    const failed = applyPlanInvariant({ _tag: "Result", output: null, status: "failed", plan: [step({ id: "s1", type: "tool_call" })] });
    expect(failed.end.status).toBe("failed");
  });
});

describe("solve evidence", () => {
  const big = (n: number) => "x".repeat(n);
  const steps = [
    { id: "s1", title: "Weather lookup", instruction: "weather", result: big(1000) },
    { id: "s2", title: "Listing availability", instruction: "availability of the listing", result: big(1000) },
    { id: "s3", title: "Listing reviews", instruction: "reviews of the listing", result: big(1000) },
  ];

  it("within budget every result is shown whole, in plan order", () => {
    const e = selectSolveEvidence("availability of the listing", steps, 10_000);
    expect(e.omitted).toEqual([]);
    expect(e.texts).toHaveLength(3);
    expect(e.texts[0]).toStartWith("Step 1 (Weather lookup): ");
    expect(e.chars).toBe(3000);
  });

  it("over budget the steps most relevant to the goal are kept whole, the rest named as not shown", () => {
    const e = selectSolveEvidence("availability of the listing", steps, 2000);
    expect(e.included.map((i) => i.id)).toEqual(["s2", "s3"]);
    expect(e.omitted).toEqual([{ id: "s1", title: "Weather lookup" }]);
    expect(e.texts.at(-1)).toContain("Not shown (over the evidence budget): Weather lookup");
    expect(e.chars).toBeLessThanOrEqual(2000);
  });

  it("a step that crosses the budget is clipped only when a useful slice remains, and says so", () => {
    const e = selectSolveEvidence("availability of the listing", steps, 1000 + MIN_CLIPPED_CHARS);
    const clipped = e.included.filter((i) => i.shown < i.of);
    expect(clipped).toHaveLength(1);
    expect(e.texts.join("\n")).toContain(`[clipped: ${MIN_CLIPPED_CHARS} of 1000 characters shown]`);
    expect(e.chars).toBeLessThanOrEqual(1000 + MIN_CLIPPED_CHARS);
  });
});

describe("blueprint on the substrate (scripted, zero tokens)", () => {
  const goal = "Check availability for listing L-9";
  const search: ToolSchema = { name: "find-listing", description: "Find a listing", parameters: [{ name: "query", type: "string", required: true }], effect: "read" };

  const run = async (turns: TestTurn[], extra: Record<string, unknown> = {}) => {
    const calls: { toolName: string; args: Record<string, unknown> }[] = [];
    const guards: { guard: string; reason: string; metadata?: Record<string, unknown> }[] = [];
    const toolLayer = mockToolServiceLayer({
      execute: (req: { toolName: string; arguments?: Record<string, unknown> }) => {
        calls.push({ toolName: req.toolName, args: req.arguments ?? {} });
        return Effect.succeed({ success: true, result: `result-of-${req.toolName}` });
      },
      getTool: (name: string) => Effect.succeed({ name, description: "t", parameters: [{ name: "query", type: "string", required: false }] }),
      register: () => Effect.void,
      listTools: () => Effect.succeed([]),
      deregister: () => Effect.void,
    });
    const program = Effect.gen(function* () {
      const bus = yield* EventBus;
      yield* bus.on("GuardFiredEmitted", (e) => Effect.sync(() => {
        if (e._tag === "GuardFiredEmitted") guards.push({ guard: e.guard, reason: e.reason, ...(e.metadata ? { metadata: e.metadata } : {}) });
      }));
      return yield* executeBlueprint({
        taskDescription: goal, taskType: "research", memoryContext: "", availableTools: ["find-listing", "availability"],
        availableToolSchemas: [search, availability], config: defaultReasoningConfig, taskId: "bp-substrate", ...extra,
      });
    });
    const result = await Effect.runPromise(
      provideTestEnvelope(program.pipe(Effect.provide(Layer.mergeAll(toolLayer, Layer.succeed(LLMService, LLMService.of(TestLLMService(turns))), EventBusLive)))),
    );
    return { result, calls, guards };
  };

  it("a baked, ungrounded date is deferred: the run neither dispatches it nor ships it as done", async () => {
    const { result, calls, guards } = await run([
      { json: { steps: [
        { title: "Find", instruction: "find the listing", type: "tool_call", toolName: "find-listing", toolArgs: { query: "L-9" } },
        { title: "Availability", instruction: "check availability", type: "tool_call", toolName: "availability", toolArgs: { listing: "L-9", checkin: "2024-11-21" }, dependsOn: ["s1"] },
      ] } },
      { text: "Available for the dates you asked." },
    ]);
    // The baked 2024 date never reaches a tool.
    expect(calls.every((c) => c.args.checkin !== "2024-11-21")).toBe(true);
    expect(guards.some((g) => g.guard === "plan-args-validated" && g.reason.includes("ungrounded-literal"))).toBe(true);
    // The deferred step ran as a composite pass (execute-time model choice): the scripted
    // model answered it, so every plan step has an ending in the result and none is open.
    const meta: Readonly<Record<string, unknown>> = result.metadata;
    expect(meta["planSteps"]).toEqual([{ id: "s1", title: "Find", ending: "done" }, { id: "s2", title: "Availability", ending: "done" }]);
    expect(meta["planIncomplete"]).toBeUndefined();
  });

  it("a tool named on an analysis step is run through the loop executor, not shipped as done", async () => {
    const { result, guards } = await run([
      { json: { steps: [
        { title: "Find", instruction: "find the listing", type: "tool_call", toolName: "find-listing", toolArgs: { query: "L-9" } },
        { title: "Listing details", instruction: "get listing_details", type: "analysis", toolName: "listing_details" },
      ] } },
      { text: "Details gathered." },
    ], { availableTools: ["find-listing", "listing_details"], availableToolSchemas: [search, details] });
    expect(guards.some((g) => g.guard === "plan-args-validated" && g.reason.includes("tool-on-analysis"))).toBe(true);
    const meta: Readonly<Record<string, unknown>> = result.metadata;
    expect(meta["planSteps"]).toEqual([expect.objectContaining({ ending: "done" }), expect.objectContaining({ ending: "done" })]);
  });

  it("the solve call's evidence is recorded on the trace", async () => {
    const { guards } = await run([
      { json: { steps: [
        { title: "Find", instruction: "find the listing", type: "tool_call", toolName: "find-listing", toolArgs: { query: "L-9" } },
        { title: "Find again", instruction: "find the listing", type: "tool_call", toolName: "find-listing", toolArgs: { query: "L-9 availability" } },
      ] } },
      { text: "Done." },
    ]);
    const solve = guards.find((g) => g.guard === "solve-evidence");
    expect(solve?.metadata).toMatchObject({ strategy: "blueprint", omitted: [], included: [expect.anything(), expect.anything()] });
  });
});

describe("the terminal on a remainder the loop executor could not finish", () => {
  it("an owed step the run budget no longer allows stays open: partial, plan-incomplete raised, the step named", async () => {
    const guards: { guard: string; reason: string }[] = [];
    const steps = [
      step({ id: "s1", type: "tool_call", status: "completed", toolName: "find-listing", result: "found" }),
      step({ id: "s2", type: "composite", toolName: "availability", toolHints: ["availability"] }),
    ];
    const plan: Plan = { id: "p", taskId: "t-open", agentId: "a", goal: "g", mode: "dag", steps, status: "active", version: 1, createdAt: "", updatedAt: "", totalTokens: 0, totalCost: 0 };
    const program = Effect.gen(function* () {
      const bus = yield* EventBus;
      yield* bus.on("GuardFiredEmitted", (e) => Effect.sync(() => {
        if (e._tag === "GuardFiredEmitted") guards.push({ guard: e.guard, reason: e.reason });
      }));
      const services = yield* resolveStrategyServices;
      return yield* runStrategy({ strategy: "blueprint", taskId: "t-open", logSite: "test" }, (run) =>
        Effect.gen(function* () {
          const ran = yield* finishOpenSteps({
            services, plan, steps, toolSummaries: [], emitLog: run.emitLog, run,
            input: { taskDescription: "g", config: defaultReasoningConfig, budgetLimits: { tokenLimit: 0 } },
          });
          expect(ran).toEqual([]);
          return { _tag: "Result" as const, output: "an answer", status: "completed" as const, plan: steps };
        }));
    });
    const result = await Effect.runPromise(
      provideTestEnvelope(program.pipe(Effect.provide(Layer.mergeAll(
        mockToolServiceLayer({ execute: () => Effect.succeed({ success: true, result: "" }), getTool: () => Effect.fail(new Error("none")), register: () => Effect.void, listTools: () => Effect.succeed([]), deregister: () => Effect.void }),
        Layer.succeed(LLMService, LLMService.of(TestLLMService([]))),
        EventBusLive,
      )))),
    );
    expect(result.status).toBe("partial");
    expect(result.metadata).toMatchObject({
      planIncomplete: { open: ["s2"] },
      planSteps: [{ id: "s1", ending: "done" }],
      verificationWarning: expect.stringContaining("s2"),
    });
    expect(guards.find((g) => g.guard === "plan-incomplete")?.reason).toContain("s2");
  });
});
