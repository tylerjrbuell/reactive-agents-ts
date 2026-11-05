// File: tests/strategies/plan-step-consumers.test.ts
//
// H3 2026-11-05 defect 3 (h3-plan-only, qwen 4/5 + cogito 5/5): the plan was
// sound — a file write whose `content` is `{{from_step:s2}}` — but analysis
// step s2 saw only the overall goal and wrote all three files' contents, which
// landed verbatim in one file. An analysis/composite step is now told its exact
// consumer, derived deterministically from the plan's references.
//
// RED-ON-CUT: drop `...withOutputDestination(plan.steps, step.id)` from
// plan-execute/step-executor.ts and the captured analysis prompt loses the
// consumer line (the integration test goes red).
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { TestLLMService, LLMService } from "@reactive-agents/llm-provider";
import { ToolService, createToolsLayer } from "@reactive-agents/tools";
import { executePlanExecute } from "../../src/strategies/plan-execute.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { provideTestEnvelope } from "../../src/kernel/envelope/run-envelope.js";
import { hydratePlan } from "../../src/types/plan.js";
import { consumerDirective, stepConsumers, withOutputDestination } from "../../src/strategies/planning/step-consumers.js";
import { buildStepExecutionPrompt } from "../../src/strategies/planning/plan-prompts.js";

const planOf = (steps: Parameters<typeof hydratePlan>[0]["steps"]) =>
  hydratePlan({ steps }, { taskId: "t", agentId: "a", goal: "Write three stock files", planMode: "linear" });

describe("step consumers (pure derivation)", () => {
  const plan = planOf([
    { title: "Draft list", instruction: "draft-the-list", type: "analysis" },
    { title: "Write", instruction: "write it", type: "tool_call", toolName: "write-note", toolArgs: { path: "low-stock.txt", content: "{{from_step:s1:full}}" } },
    { title: "Notes", instruction: "unrelated-notes", type: "analysis" },
    { title: "Log", instruction: "log it", type: "tool_call", toolName: "log", toolArgs: { message: "Summary: {{from_step:s3}} (end)" } },
  ]);

  it("a whole-argument consumer names the file the output becomes", () => {
    const consumers = stepConsumers(plan.steps, "s1");
    expect(consumers).toEqual([
      { consumerId: "s2", toolName: "write-note", argName: "content", whole: true, template: "{{from_step:s1:full}}", target: "low-stock.txt" },
    ]);
    expect(consumerDirective(consumers)).toContain(
      "Your entire reply becomes the content of low-stock.txt (the `content` argument of write-note (step s2)). Output only that content — no file names, labels or other files.",
    );
  });

  it("an interpolated consumer names the slot it fills", () => {
    const directive = consumerDirective(stepConsumers(plan.steps, "s3"));
    expect(directive).toContain("fills the {{from_step}} slot in the `message` argument of log (step s4)");
    expect(directive).toContain('"Summary: {{from_step:s3}} (end)"');
  });

  it("a step no tool argument consumes leaves the prompt unchanged", () => {
    expect(withOutputDestination(plan.steps, "s2")).toEqual({});
    const base = { goal: "g", step: plan.steps[0]!, stepIndex: 0, totalSteps: 4, priorResults: [], scopedTools: [] };
    expect(buildStepExecutionPrompt({ ...base, ...withOutputDestination(plan.steps, "s2") })).toBe(buildStepExecutionPrompt(base));
    expect(buildStepExecutionPrompt(base)).not.toContain("OUTPUT DESTINATION");
  });
});

describe("plan-execute tells an analysis step its consumer (integration)", () => {
  const PLAN = JSON.stringify({
    steps: [
      { title: "Draft list", instruction: "draft-the-list", type: "analysis" },
      { title: "Write", instruction: "write the list", type: "tool_call", toolName: "write-note", toolArgs: { path: "low-stock.txt", content: "{{from_step:s1:full}}" } },
      { title: "Notes", instruction: "unrelated-notes", type: "analysis" },
    ],
  });

  it("the analysis prompt carries its consumer line; a step feeding nothing does not", async () => {
    const prompts: string[] = [];
    const base = TestLLMService([
      { match: "planning agent", text: PLAN },
      { match: "draft-the-list", text: "widget-a" },
      { match: "unrelated-notes", text: "notes" },
      { match: "GOAL:", text: "SATISFIED: done." },
      { text: "Final answer." },
    ]);
    const llm = Layer.succeed(LLMService, LLMService.of({
      ...base,
      complete: (req: Parameters<typeof base.complete>[0]) => {
        prompts.push(JSON.stringify(req));
        return base.complete(req);
      },
    }));
    const written: unknown[] = [];
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
        (args) => Effect.sync(() => { written.push(args.content); return "ok"; }),
      );
      return yield* executePlanExecute({
        taskDescription: "Write three stock files",
        taskType: "files",
        memoryContext: "",
        availableTools: ["write-note"],
        config: defaultReasoningConfig,
      });
    });
    await Effect.runPromise(provideTestEnvelope(program.pipe(Effect.provide(Layer.merge(llm, createToolsLayer())))));

    const draftPrompt = prompts.find((p) => p.includes("draft-the-list") && p.includes("CURRENT STEP"));
    const notesPrompt = prompts.find((p) => p.includes("unrelated-notes") && p.includes("CURRENT STEP"));
    expect(draftPrompt).toContain("Your entire reply becomes the content of low-stock.txt");
    expect(notesPrompt).toBeDefined();
    expect(notesPrompt).not.toContain("OUTPUT DESTINATION");
    expect(written).toEqual(["widget-a"]);
  }, 30_000);
});
