// File: tests/strategies/plan-fanout-split.test.ts
//
// bonsai H3 2026-11-05 (h3-plan-only, bonsai 5/5 failures, qwen 1/1): one
// analysis step fed three file writes (`content: "{{from_step:s2}}"` each). Its
// prompt said "your entire reply becomes the content of X" once per file, so
// the first file got everything. Plan validation now gives each target file its
// own producer copy (planning/fanout-split.ts), emitting
// `guard-fired{guard:"plan-fanout-split"}`.
//
// RED-ON-CUT: make `splitFanOutProducers` return `{ steps: [...steps], splits: [] }`
// unconditionally and the split tests, the guard-event tests and the
// per-file content assertions go red.
import { describe, it, expect } from "bun:test";
import { Effect, Layer, Ref } from "effect";
import { TestLLMService, LLMService } from "@reactive-agents/llm-provider";
import { ToolService, createToolsLayer } from "@reactive-agents/tools";
import { EventBus, EventBusLive, type AgentEvent } from "@reactive-agents/core";
import { executePlanExecute } from "../../src/strategies/plan-execute.js";
import { executeBlueprint } from "../../src/strategies/blueprint.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { provideTestEnvelope } from "../../src/kernel/envelope/run-envelope.js";
import { hydratePlan, type LLMPlanStep } from "../../src/types/plan.js";
import { splitFanOutProducers } from "../../src/strategies/planning/fanout-split.js";
import { withOutputDestination } from "../../src/strategies/planning/step-consumers.js";
import { mockToolServiceLayer } from "../../src/testing/tool-service-mock.js";

const planOf = (steps: readonly LLMPlanStep[]) =>
  hydratePlan({ steps }, { taskId: "t", agentId: "a", goal: "Write three stock files", planMode: "linear" });

const write = (path: string, content: string, extra: Partial<LLMPlanStep> = {}): LLMPlanStep => ({
  title: `Write ${path}`, instruction: `write ${path}`, type: "tool_call", toolName: "write-note",
  toolArgs: { path, content }, ...extra,
});

const FILES = ["low-stock.txt", "reorder.txt", "summary.txt"] as const;

/** One read step, one analysis step, three whole-output writes of the analysis. */
const FANOUT_STEPS: readonly LLMPlanStep[] = [
  { title: "Read inventory", instruction: "read it", type: "tool_call", toolName: "read-note", toolArgs: { path: "inventory.csv" } },
  { title: "Analyze", instruction: "analyze-inventory using {{from_step:s1:full}}", type: "analysis", dependsOn: ["s1"] },
  write(FILES[0], "{{from_step:s2}}", { dependsOn: ["s2"] }),
  write(FILES[1], "{{from_step:s2:full}}"),
  write(FILES[2], "{{from_step:s2}}"),
];

describe("splitFanOutProducers (pure)", () => {
  it("one analysis step feeding three files becomes three producers, each naming exactly one file", () => {
    const { steps, splits } = splitFanOutProducers(planOf(FANOUT_STEPS).steps);
    expect(steps.map((s) => [s.id, s.seq, s.type, s.toolName ?? null])).toEqual([
      ["s1", 1, "tool_call", "read-note"],
      ["s2", 2, "analysis", null],
      ["s3", 3, "analysis", null],
      ["s4", 4, "analysis", null],
      ["s5", 5, "tool_call", "write-note"],
      ["s6", 6, "tool_call", "write-note"],
      ["s7", 7, "tool_call", "write-note"],
    ]);
    expect(splits).toEqual([{ producerId: "s2", producerIds: ["s2", "s3", "s4"], targets: [...FILES] }]);

    // Copies keep the instruction and the dependencies (re-pointed at the renumbered ids).
    for (const id of ["s2", "s3", "s4"]) {
      const p = steps.find((s) => s.id === id)!;
      expect(p.instruction).toBe("analyze-inventory using {{from_step:s1:full}}");
      expect(p.dependsOn).toEqual(["s1"]);
    }
    // Each write reads its own producer; the reference mode is kept.
    expect(steps.slice(4).map((s) => [s.toolArgs?.path, s.toolArgs?.content])).toEqual([
      [FILES[0], "{{from_step:s2}}"],
      [FILES[1], "{{from_step:s3:full}}"],
      [FILES[2], "{{from_step:s4}}"],
    ]);
    expect(steps[4]!.dependsOn).toEqual(["s2"]);

    // The bug: one producer told three different files. Now each directive names one.
    FILES.forEach((file, i) => {
      const directive = withOutputDestination(steps, `s${i + 2}`).outputDestination ?? "";
      expect(directive).toContain(`Your entire reply becomes the content of ${file}`);
      for (const other of FILES.filter((f) => f !== file)) expect(directive).not.toContain(other);
    });
  });

  it("a single-consumer plan is unchanged", () => {
    const steps = planOf([FANOUT_STEPS[0]!, FANOUT_STEPS[1]!, FANOUT_STEPS[2]!]).steps;
    expect(splitFanOutProducers(steps)).toEqual({ steps, splits: [] });
  });

  it("two writes of the same file, a tool_call producer, and a plan with a dangling reference are unchanged", () => {
    const sameFile = planOf([FANOUT_STEPS[1]!, write("a.txt", "{{from_step:s1}}"), write("a.txt", "{{from_step:s1:full}}")]).steps;
    expect(splitFanOutProducers(sameFile).splits).toEqual([]);
    const toolProducer = planOf([FANOUT_STEPS[0]!, write("a.txt", "{{from_step:s1}}"), write("b.txt", "{{from_step:s1}}")]).steps;
    expect(splitFanOutProducers(toolProducer).splits).toEqual([]);
    const dangling = planOf([...FANOUT_STEPS, write("z.txt", "{{from_step:s9}}")]).steps;
    expect(splitFanOutProducers(dangling)).toEqual({ steps: dangling, splits: [] });
  });

  it("partial consumers and later steps keep pointing at the right renumbered step", () => {
    const steps = planOf([
      { title: "Analyze", instruction: "analyze", type: "analysis" },
      write("a.txt", "{{from_step:s1}}"),
      write("b.txt", "{{from_step:s1}}"),
      { title: "Log", instruction: "log", type: "tool_call", toolName: "log", toolArgs: { message: "Done: {{from_step:s1}} then {{from_step:s3}}" } },
    ]).steps;
    const { steps: out } = splitFanOutProducers(steps);
    expect(out.map((s) => s.id)).toEqual(["s1", "s2", "s3", "s4", "s5"]);
    // Log interpolates the analysis (stays on the original s1) and b.txt's write (old s3 → s4).
    expect(out[4]!.toolArgs?.message).toBe("Done: {{from_step:s1}} then {{from_step:s4}}");
  });
});

/** Run `program` with an EventBus and collect its plan-fanout-split guard events. */
const withGuardLog = async <A, E>(program: Effect.Effect<A, E, EventBus>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const events = yield* Ref.make<AgentEvent[]>([]);
      const bus = yield* EventBus;
      yield* bus.on("GuardFiredEmitted", (ev) =>
        ev._tag === "GuardFiredEmitted" && ev.guard === "plan-fanout-split" ? Ref.update(events, (xs) => [...xs, ev]) : Effect.void);
      const result = yield* program;
      return { result, guards: yield* Ref.get(events) };
    }).pipe(Effect.provide(EventBusLive)),
  );

const PLAN_JSON = JSON.stringify({
  steps: [
    { title: "Analyze", instruction: "analyze-inventory", type: "analysis" },
    write(FILES[0], "{{from_step:s1}}"),
    write(FILES[1], "{{from_step:s1}}"),
    write(FILES[2], "{{from_step:s1}}"),
  ],
});

/** Each producer prompt names one file; reply with that file's own content. */
const perFileTurns = FILES.map((file) => ({ match: `content of ${file}`, text: `content-for-${file}` }));

describe("plan-execute splits a fan-out producer at plan validation (integration)", () => {
  it("each file gets its own producer's reply; one guard event", async () => {
    const llm = TestLLMService([
      { match: "planning agent", text: PLAN_JSON },
      ...perFileTurns,
      { match: "GOAL:", text: "SATISFIED: done." },
      { text: "Final answer." },
    ]);
    const written: Record<string, unknown> = {};
    const program = Effect.gen(function* () {
      const tools = yield* ToolService;
      yield* tools.register(
        {
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
        },
        (args) => Effect.sync(() => { written[String(args.path)] = args.content; return "ok"; }),
      );
      return yield* executePlanExecute({
        taskDescription: "Write three stock files",
        taskType: "files",
        memoryContext: "",
        availableTools: ["write-note"],
        config: defaultReasoningConfig,
      });
    });
    const { guards } = await withGuardLog(provideTestEnvelope(
      program.pipe(Effect.provide(Layer.merge(Layer.succeed(LLMService, LLMService.of(llm)), createToolsLayer()))),
    ));
    expect(written).toEqual(Object.fromEntries(FILES.map((f) => [f, `content-for-${f}`])));
    expect(guards).toHaveLength(1);
    expect(guards[0]).toMatchObject({ guard: "plan-fanout-split", metadata: { producerId: "s1", producerIds: ["s1", "s2", "s3"], targets: [...FILES] } });
  }, 30_000);
});

describe("blueprint reaches the same split (integration)", () => {
  it("emits one plan-fanout-split guard and writes each file from its own producer", async () => {
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
    const llm = TestLLMService([
      { json: JSON.parse(PLAN_JSON) },
      ...perFileTurns,
      { text: "Wrote the three files." },
    ]);
    const { guards } = await withGuardLog(provideTestEnvelope(
      executeBlueprint({
        taskDescription: "Write three stock files",
        taskType: "files",
        memoryContext: "",
        availableTools: ["write-note"],
        availableToolSchemas: [{ name: "write-note", description: "write", parameters: [] }],
        config: defaultReasoningConfig,
      }).pipe(Effect.provide(Layer.mergeAll(tools, Layer.succeed(LLMService, LLMService.of(llm))))),
    ));
    expect(guards).toHaveLength(1);
    expect(guards[0]).toMatchObject({ metadata: { producerIds: ["s1", "s2", "s3"], targets: [...FILES] } });
    expect(written).toEqual(Object.fromEntries(FILES.map((f) => [f, `content-for-${f}`])));
  }, 30_000);
});
