/**
 * plan-execute-approval-preflight.test.ts — a planner-emitted tool_call step
 * its tool's preflight refuses never pauses for approval in detach mode; the
 * refusal comes back as a failed step result. Allowed steps still pause.
 */
import { describe, it, expect } from "bun:test";
import { Effect, Option } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { executeStep, type StepExecResult } from "../../src/strategies/plan-execute/step-executor.js";
import { runStrategy } from "../../src/strategies/substrate/strategy-run.js";
import { provideTestEnvelope, buildRunEnvelope } from "../../src/kernel/envelope/run-envelope.js";
import { resolveStrategyServices, type StrategyServices } from "../../src/kernel/utils/service-utils.js";
import type { ToolServiceInstance } from "../../src/kernel/state/kernel-state.js";
import type { Plan, PlanStep } from "../../src/types/plan.js";

const REFUSAL = 'Command "gh" is not in the allowlist.';

const toolService = (executed: string[]): Option.Option<ToolServiceInstance> =>
  Option.some({
    execute: (req) =>
      Effect.sync(() => {
        executed.push(String(req.arguments.command ?? ""));
        return { success: true, result: "ran" };
      }),
    getTool: () =>
      Effect.succeed({
        parameters: [],
        preflight: (args: Record<string, unknown>): string | undefined =>
          String(args.command ?? "").startsWith("ls") ? undefined : REFUSAL,
      }),
    listTools: () => Effect.succeed([]),
  });

const stepFor = (command: string): PlanStep => ({
  id: "s1",
  seq: 1,
  title: "shell",
  instruction: "run shell",
  type: "tool_call",
  toolName: "shell",
  toolArgs: { command },
  status: "pending",
  retries: 0,
  tokensUsed: 0,
});

const plan = (step: PlanStep): Plan => ({
  id: "p1",
  taskId: "t1",
  agentId: "a1",
  goal: "g",
  mode: "linear",
  steps: [step],
  status: "active",
  version: 1,
  createdAt: "",
  updatedAt: "",
  totalTokens: 0,
  totalCost: 0,
});

const runStep = (command: string, executed: string[]) => {
  const step = stepFor(command);
  return Effect.runPromise(
    Effect.gen(function* () {
      const services: StrategyServices = { ...(yield* resolveStrategyServices), toolService: toolService(executed) };
      let captured: StepExecResult | undefined;
      yield* runStrategy(
        { strategy: "plan-execute-reflect", taskId: "t1", logSite: "test" },
        (run) =>
          executeStep(step, 0, plan(step), [], { taskDescription: "t", availableToolSchemas: [] }, [], services, 3, undefined, () => Effect.void, run).pipe(
            Effect.map((r) => {
              captured = r;
              return { _tag: "Result" as const, output: "x", status: "completed" as const };
            }),
          ),
      );
      if (captured === undefined) throw new Error("step did not run");
      return captured;
    }).pipe(
      Effect.provide(TestLLMServiceLayer([])),
      (e) => provideTestEnvelope(e, buildRunEnvelope({ approvalPolicy: { mode: "detach", tools: new Set(["shell"]) } })),
    ),
  );
};

describe("plan-execute detach pause — preflight", () => {
  it("refused step: no pause, no execution, refusal returned as a failed step", async () => {
    const executed: string[] = [];
    const r = await runStep("gh --version", executed);
    expect(r.pause).toBeUndefined();
    expect(executed).toEqual([]);
    expect(r.success).toBe(false);
    expect(r.output).toContain(REFUSAL);
  });

  it("allowed step still pauses for approval", async () => {
    const r = await runStep("ls", []);
    expect(r.pause?.awaitingApprovalFor?.args).toEqual({ command: "ls" });
  });
});
