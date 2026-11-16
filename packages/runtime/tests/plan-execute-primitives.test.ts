/**
 * Plan / execute primitives (spec 2026-11-16-plan-execute-posture-robustness.md):
 * `agent.plan()`, `agent.execute()`, `agent.run(input, { plan })`, `session.plan`,
 * `session.setPlan()`, and the `planToolCatalog` harness flag. All through the
 * real runtime with the test provider; no live model.
 *
 * Run: bun test packages/runtime/tests/plan-execute-primitives.test.ts --timeout 30000
 */
import { describe, test, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { LLMService, TestLLMService } from "@reactive-agents/llm-provider";
import { EventBus, type AgentEvent, type Plan } from "@reactive-agents/core";
import { ReactiveAgents } from "../src/builder.js";
import { PlanNoStepsError } from "../src/errors/plan-no-steps-error.js";
import type { AgentStreamEvent } from "../src/stream-types.js";
import { normalizeSteps, planFromWatch, stepChanges, toolHintOf } from "../src/agent/plan-facade.js";
import { editPlan, freshPlanMeta, planOfTodo } from "../src/chat/session-plan.js";

type Script = ReadonlyArray<Record<string, unknown>>;

const build = (script: Script, opts?: { todo?: boolean }) => {
  const b = ReactiveAgents.create()
    .withName("plan-execute")
    .withProvider("test")
    .withModel("test-model")
    .withReasoning({ defaultStrategy: "reactive" })
    .withReplayLLM(Layer.succeed(LLMService, LLMService.of(TestLLMService(script as never))))
    .withMaxIterations(6);
  return (opts?.todo ? b.withMetaTools({ todo: true }) : b).build();
};

const listen = async (agent: Awaited<ReturnType<typeof build>>, tags: ReadonlySet<string>) => {
  const seen: AgentEvent[] = [];
  await agent.runtime.runPromise(
    EventBus.pipe(Effect.flatMap((bus) => bus.subscribe((e) => Effect.sync(() => { if (tags.has(e._tag)) seen.push(e); })))),
  );
  return seen;
};

const PLAN_REPLY = "Here is my plan:\n1. Read the config file\n2. Rewrite the scripts (tool: file-write)\n3. Run the tests";

describe("pure plan mapping", () => {
  test("toolHintOf reads `tool: name`", () => {
    expect(toolHintOf("Rewrite the scripts (tool: file-write)")).toBe("file-write");
    expect(toolHintOf("tool: `web-search` first")).toBe("web-search");
    expect(toolHintOf("Just think")).toBeUndefined();
  });

  test("normalizeSteps: ids default to position, duplicates stay unique, blanks drop, hints parse", () => {
    const steps = normalizeSteps(["a", { title: "b", tool: "t" }, "  ", { id: "1", title: "dup" }, "go (tool: x)"]);
    expect(steps.map((s) => s.id)).toEqual(["1", "2", "1-4", "5"]);
    expect(steps[1]).toEqual({ id: "2", title: "b", status: "pending", tool: "t" });
    expect(steps[3]!.tool).toBe("x");
  });

  test("stepChanges: only shared ids whose status moved", () => {
    const a: Plan = { id: "p", goal: "g", createdAt: 0, source: "model", steps: [{ id: "1", title: "x", status: "pending" }, { id: "2", title: "y", status: "pending" }] };
    const b: Plan = { ...a, steps: [{ id: "1", title: "x", status: "done" }, { id: "2", title: "y", status: "pending" }, { id: "3", title: "new", status: "pending" }] };
    const ev = stepChanges(a, b, { timestamp: 1 });
    expect(ev.map((e) => `${e.stepId}:${e.from}>${e.to}`)).toEqual(["1:pending>done"]);
  });

  test("planFromWatch with no snapshot keeps the known steps", () => {
    const known = [{ id: "1", title: "x", status: "pending" as const }];
    expect(planFromWatch({ snapshot: undefined, findings: [] }, { id: "p", goal: "g", createdAt: 0, source: "model" }, known).steps).toEqual(known);
  });

  test("session plan: todo <-> plan round trip; user edit is user-edited and seeds the list", () => {
    const meta = freshPlanMeta("s", 5);
    expect(planOfTodo([], meta)).toBeUndefined();
    const plan = planOfTodo([{ id: "1", title: "a", status: "completed" }, { id: "2", title: "b", status: "in_progress" }], meta)!;
    expect(plan.steps.map((s) => s.status)).toEqual(["done", "in-progress"]);
    const edit = editPlan(["first", { title: "second", tool: "file-read" }], meta, 9);
    expect(edit.seed).toEqual([{ id: "1", title: "first", status: "pending" }, { id: "2", title: "second", status: "pending", tool: "file-read" }]);
    expect(edit.plan.source).toBe("user-edited");
    expect(edit.event).toMatchObject({ _tag: "PlanRecorded", source: "user-edited", planId: meta.id });
    expect(planOfTodo(edit.seed, edit.meta)!.steps[1]!.tool).toBe("file-read");
  });
});

describe("agent.plan()", () => {
  test("returns a non-empty harness-derived plan from a prose reply and publishes PlanRecorded", async () => {
    const agent = await build([{ text: PLAN_REPLY }, { text: PLAN_REPLY }]);
    try {
      const events = await listen(agent, new Set(["PlanRecorded"]));
      const plan = await agent.plan("Migrate the build");
      expect(plan.steps.map((s) => s.title)).toEqual(["Read the config file", "Rewrite the scripts (tool: file-write)", "Run the tests"]);
      expect(plan.steps.every((s) => s.status === "pending")).toBe(true);
      expect(plan.steps[1]!.tool).toBe("file-write");
      expect(plan.source).toBe("harness-derived");
      expect(plan.goal).toBe("Migrate the build");
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ _tag: "PlanRecorded", planId: plan.id, source: "harness-derived" });
    } finally {
      await agent.dispose();
    }
  }, 30000);

  test("a model-recorded todo list is the plan (source model)", async () => {
    const agent = await build(
      [
        { toolCall: { name: "todo", args: { action: "add", items: ["gather", "write"] } } },
        { text: "Plan recorded: gather then write." },
        { text: "Plan recorded: gather then write." },
      ],
      { todo: true },
    );
    try {
      const plan = await agent.plan("Do the thing");
      expect(plan.steps.map((s) => s.title)).toEqual(["gather", "write"]);
      expect(plan.source).toBe("model");
    } finally {
      await agent.dispose();
    }
  }, 30000);

  test("no steps anywhere rejects with the typed PlanNoStepsError (never a silent empty plan)", async () => {
    const agent = await build([{ text: "I would just think about it." }, { text: "I would just think about it." }]);
    try {
      const events = await listen(agent, new Set(["PlanRecorded"]));
      const err = await agent.plan("Do the thing").then(() => undefined, (e: unknown) => e);
      expect(err).toBeInstanceOf(PlanNoStepsError);
      expect((err as PlanNoStepsError).goal).toBe("Do the thing");
      expect(events).toHaveLength(0);
    } finally {
      await agent.dispose();
    }
  }, 30000);
});

const PLAN: Plan = {
  id: "plan-1",
  goal: "Migrate the build",
  createdAt: 1,
  source: "user-edited",
  steps: [
    { id: "1", title: "Read the config", status: "pending" },
    { id: "2", title: "Rewrite the scripts", status: "pending", tool: "file-write" },
    { id: "3", title: "Run the tests", status: "pending" },
  ],
};

describe("agent.execute() / agent.run(input, { plan })", () => {
  test("seeds the run from the plan checklist: result.plan carries per-step status; PlanStepStatusChanged fires once per change", async () => {
    const agent = await build(
      [
        { toolCall: { name: "todo", args: { action: "done", id: 1 } } },
        { text: "FINAL ANSWER: step one done" },
        { text: "FINAL ANSWER: step one done" },
      ],
      { todo: true },
    );
    try {
      const events = await listen(agent, new Set(["PlanStepStatusChanged"]));
      const result = await agent.execute(PLAN);
      // Steps 2 and 3 exist only because the run was SEEDED from the plan (the model only marked id 1).
      expect(result.plan.steps.map((s) => `${s.id}:${s.status}`)).toEqual(["1:done", "2:pending", "3:pending"]);
      expect(result.plan.steps[1]!.tool).toBe("file-write");
      expect(result.plan.id).toBe("plan-1");
      expect(events.map((e) => e._tag === "PlanStepStatusChanged" && `${e.stepId}:${e.from}>${e.to}`)).toEqual(["1:pending>done"]);
    } finally {
      await agent.dispose();
    }
  }, 30000);

  test("run(input, { plan }) reports result.plan too; run without a plan has no plan key", async () => {
    const agent = await build(
      [
        { toolCall: { name: "todo", args: { action: "done", id: 2 } } },
        { text: "FINAL ANSWER: ok" },
        { text: "FINAL ANSWER: ok" },
        { text: "FINAL ANSWER: plain" },
        { text: "FINAL ANSWER: plain" },
      ],
      { todo: true },
    );
    try {
      const withPlan = await agent.run("Go", { plan: PLAN });
      expect(withPlan.plan?.steps.map((s) => `${s.id}:${s.status}`)).toEqual(["1:pending", "2:done", "3:pending"]);
      const plain = await agent.run("Go");
      expect("plan" in plain).toBe(false);
    } finally {
      await agent.dispose();
    }
  }, 30000);

  test("an empty plan runs unseeded and reports itself unchanged (same as no plan)", async () => {
    const agent = await build([{ text: "FINAL ANSWER: ok" }, { text: "FINAL ANSWER: ok" }]);
    try {
      const events = await listen(agent, new Set(["PlanStepStatusChanged"]));
      const empty: Plan = { ...PLAN, steps: [] };
      const result = await agent.execute(empty);
      expect(result.plan).toEqual(empty);
      expect(events).toHaveLength(0);
    } finally {
      await agent.dispose();
    }
  }, 30000);
});

describe("chat sessions", () => {
  const turn = async (session: ReturnType<Awaited<ReturnType<typeof build>>["session"]>, msg: string) => {
    const events: AgentStreamEvent[] = [];
    for await (const e of session.runStream(msg, { density: "full" })) events.push(e);
    return events.filter((e): e is Extract<AgentStreamEvent, { _tag: "ChecklistUpdated" }> => e._tag === "ChecklistUpdated");
  };
  const rows = (u: Extract<AgentStreamEvent, { _tag: "ChecklistUpdated" }>) => u.checklist.root.rows.filter((r) => r.kind === "advisory").map((r) => `${r.id}:${r.status}`);

  test("a plan turn's harness-derived list (ids 1..n) carries to the next execute turn; session.plan reads it", async () => {
    const agent = await build([{ text: PLAN_REPLY }, { text: PLAN_REPLY }, { text: "FINAL ANSWER: exec" }, { text: "FINAL ANSWER: exec" }]);
    try {
      const session = agent.session({ mode: "plan" });
      expect(session.plan).toBeUndefined();
      await turn(session, "plan the migration");
      expect(session.plan?.steps.map((s) => s.id)).toEqual(["1", "2", "3"]);
      session.setMode("execute");
      const u = await turn(session, "go");
      expect(rows(u[0]!)).toEqual(["1:pending", "2:pending", "3:pending"]);
    } finally {
      await agent.dispose();
    }
  }, 30000);

  test("setPlan replaces the list, publishes PlanRecorded (user-edited), and the next turn seeds from the edit", async () => {
    const agent = await build([{ text: "FINAL ANSWER: exec" }, { text: "FINAL ANSWER: exec" }]);
    try {
      const events = await listen(agent, new Set(["PlanRecorded"]));
      const session = agent.session();
      const plan = session.setPlan(["Read config", { title: "Rewrite scripts", tool: "file-write" }]);
      expect(plan.source).toBe("user-edited");
      expect(session.plan?.steps.map((s) => `${s.id}:${s.title}:${s.tool ?? ""}`)).toEqual(["1:Read config:", "2:Rewrite scripts:file-write"]);
      await new Promise((r) => setTimeout(r, 5));
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ _tag: "PlanRecorded", source: "user-edited" });
      const u = await turn(session, "go");
      expect(rows(u[0]!)).toEqual(["1:pending", "2:pending"]);
    } finally {
      await agent.dispose();
    }
  }, 30000);
});
