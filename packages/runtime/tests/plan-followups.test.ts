/**
 * Plan follow-ups: provenance from the checklist row origin, tool hints carried
 * through the to-do seed, buffered session turns carrying the list, streamed
 * session turns publishing PlanStepStatusChanged (session-stamped), durable runs
 * honoring the seed, and the default-on plan tool catalog reaching the model.
 * Real runtime, test provider; no live model.
 *
 * Run: bun test packages/runtime/tests/plan-followups.test.ts --timeout 30000
 */
import { describe, test, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LLMService, TestLLMService } from "@reactive-agents/llm-provider";
import { EventBus, type AgentEvent, type ChecklistSnapshot } from "@reactive-agents/core";
import { ReactiveAgents } from "../src/builder.js";
import { planSourceOf } from "../src/agent/plan-watch.js";
import { planOfTodo, freshPlanMeta } from "../src/chat/session-plan.js";
import { readTodoSeed, snapshotToTodoSeed, todoSeedMetadata, type TodoSeedItem } from "../src/chat/todo-seed.js";
import { todoStepEvents } from "../src/chat/plan-step-events.js";

type Script = ReadonlyArray<Record<string, unknown>>;
type Req = import("@reactive-agents/llm-provider").CompletionRequest;

const snap = (rows: ChecklistSnapshot["root"]["rows"]): ChecklistSnapshot => ({
  root: { key: "root", label: "root", rows, requirements: { done: 0, total: 0 }, advisory: { done: 0, total: 0 }, activeAdvisoryIds: [], children: [] },
  lastSeq: 0,
});

const layerOf = (script: Script, captured: Req[] = []): Layer.Layer<LLMService> => {
  const base = TestLLMService(script as never);
  return Layer.succeed(LLMService, LLMService.of({ ...base, complete: (r) => (captured.push(r), base.complete(r)), stream: (r) => (captured.push(r), base.stream(r)) }));
};

const build = (script: Script, captured: Req[] = []) =>
  ReactiveAgents.create()
    .withName("plan-followups")
    .withProvider("test")
    .withModel("test-model")
    .withReasoning({ defaultStrategy: "reactive" })
    .withMetaTools({ todo: true })
    .withReplayLLM(layerOf(script, captured))
    .withRequiredTools({ adaptive: false })
    .withMaxIterations(6)
    .build();

const listen = async (agent: Awaited<ReturnType<typeof build>>, tags: ReadonlySet<string>) => {
  const seen: AgentEvent[] = [];
  await agent.runtime.runPromise(
    EventBus.pipe(Effect.flatMap((bus) => bus.subscribe((e) => Effect.sync(() => { if (tags.has(e._tag)) seen.push(e); })))),
  );
  return seen;
};

describe("provenance and tool hints (pure)", () => {
  test("planSourceOf reads the row origin: harness-derived rows => harness-derived, else model", () => {
    const row = (origin?: "harness-derived") => ({ id: "1", kind: "advisory" as const, title: "t", status: "pending" as const, ...(origin ? { origin } : {}) });
    expect(planSourceOf(snap([row("harness-derived")]))).toBe("harness-derived");
    expect(planSourceOf(snap([row()]))).toBe("model");
    expect(planSourceOf(undefined)).toBe("model");
  });

  test("snapshotToTodoSeed carries tool and origin; readTodoSeed round-trips them; a non-string tool is dropped as malformed", () => {
    const seed = snapshotToTodoSeed(snap([{ id: "1", kind: "advisory", title: "write", status: "pending", tool: "file-write", origin: "harness-derived" }]));
    expect(seed).toEqual([{ id: "1", title: "write", status: "pending", tool: "file-write", origin: "harness-derived" }]);
    expect(readTodoSeed({ metadata: { tags: [], ...todoSeedMetadata(seed) } } as never)).toEqual(seed);
    expect(readTodoSeed({ metadata: { context: { initialTodo: [{ id: "1", title: "t", status: "pending", tool: 5 }] } } } as never)).toBeUndefined();
  });

  test("planOfTodo: a row's own tool wins, and harness-derived rows make a model-sourced plan harness-derived", () => {
    const items: TodoSeedItem[] = [{ id: "1", title: "a", status: "pending", tool: "web-search", origin: "harness-derived" }, { id: "2", title: "b", status: "pending" }];
    const plan = planOfTodo(items, { ...freshPlanMeta("s", 0), tools: { "1": "ignored", "2": "file-read" } });
    expect(plan?.source).toBe("harness-derived");
    expect(plan?.steps.map((s) => s.tool)).toEqual(["web-search", "file-read"]);
    expect(planOfTodo(items, { ...freshPlanMeta("s", 0), source: "user-edited" })?.source).toBe("user-edited");
  });

  test("todoStepEvents: one session-stamped event per step whose status moved; new rows emit nothing", () => {
    const before: TodoSeedItem[] = [{ id: "1", title: "a", status: "pending" }, { id: "2", title: "b", status: "pending" }];
    const after: TodoSeedItem[] = [{ id: "1", title: "a", status: "completed" }, { id: "2", title: "b", status: "pending" }, { id: "3", title: "c", status: "pending" }];
    const events = todoStepEvents(before, after, "sess_x", 7);
    expect(events).toEqual([{ _tag: "PlanStepStatusChanged", planId: "plan-sess_x", stepId: "1", from: "pending", to: "done", sessionId: "sess_x", timestamp: 7 }]);
    expect(todoStepEvents([], after, "sess_x", 7)).toEqual([]);
  });
});

const TURN1 = [
  { toolCall: { name: "todo", args: { action: "add", items: ["step one", "step two"] } } },
  { text: "FINAL ANSWER: one" },
  { text: "FINAL ANSWER: one" },
];
const TURN2 = [
  { toolCall: { name: "todo", args: { action: "done", id: 1 } } },
  { text: "FINAL ANSWER: two" },
  { text: "FINAL ANSWER: two" },
];

describe("session turns", () => {
  test("a buffered tool turn carries the list: turn 2 sees turn 1's rows and moves one", async () => {
    const agent = await build([...TURN1, ...TURN2]);
    try {
      const session = agent.session();
      await session.chat("plan two things", { useTools: true });
      expect(session.todo().map((t) => `${t.id}:${t.status}`)).toEqual(["1:pending", "2:pending"]);
      await session.chat("do the first", { useTools: true });
      expect(session.todo().map((t) => `${t.id}:${t.status}`)).toEqual(["1:completed", "2:pending"]);
    } finally {
      await agent.dispose();
    }
  }, 60000);

  test("a buffered turn announces the step change with the session id", async () => {
    const agent = await build([...TURN1, ...TURN2]);
    try {
      const events = await listen(agent, new Set(["PlanStepStatusChanged"]));
      const session = agent.session({ id: "sess_followups" });
      await session.chat("plan two things", { useTools: true });
      await session.chat("do the first", { useTools: true });
      await new Promise((r) => setTimeout(r, 10));
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ _tag: "PlanStepStatusChanged", stepId: "1", from: "pending", to: "done", sessionId: "sess_followups", planId: "plan-sess_followups" });
    } finally {
      await agent.dispose();
    }
  }, 60000);

  test("a streamed turn announces the step change with the session id", async () => {
    const agent = await build([...TURN1, ...TURN2]);
    try {
      const events = await listen(agent, new Set(["PlanStepStatusChanged"]));
      const session = agent.session({ id: "sess_streamed" });
      for await (const _ of session.runStream("plan two things", { density: "full" })) void _;
      for await (const _ of session.runStream("do the first", { density: "full" })) void _;
      await new Promise((r) => setTimeout(r, 10));
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ _tag: "PlanStepStatusChanged", stepId: "1", to: "done", sessionId: "sess_streamed" });
    } finally {
      await agent.dispose();
    }
  }, 60000);

  test("setPlan's PlanRecorded carries the session id and session.plan uses the same plan id", async () => {
    const agent = await build([{ text: "FINAL ANSWER: x" }]);
    try {
      const events = await listen(agent, new Set(["PlanRecorded"]));
      const session = agent.session({ id: "sess_edit" });
      session.setPlan(["a", { title: "b", tool: "file-write" }]);
      await new Promise((r) => setTimeout(r, 10));
      expect(events[0]).toMatchObject({ _tag: "PlanRecorded", sessionId: "sess_edit", source: "user-edited" });
      expect(session.plan?.id).toBe((events[0] as { planId: string }).planId);
    } finally {
      await agent.dispose();
    }
  }, 30000);
});

describe("durable runs", () => {
  test("a durable agent's run({ plan }) seeds the checklist from the plan (initialTodo is carried)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-plan-durable-"));
    const agent = await ReactiveAgents.create()
      .withName("plan-durable")
      .withProvider("test")
      .withModel("test-model")
      .withReasoning({ defaultStrategy: "reactive" })
      .withReplayLLM(layerOf([{ text: "FINAL ANSWER: ok" }, { text: "FINAL ANSWER: ok" }]))
      .withDurableRuns({ dir })
      .withMaxIterations(4)
      .build();
    try {
      const events = await listen(agent, new Set(["LedgerEntryAppended"]));
      const result = await agent.run("go", {
        plan: { id: "p", goal: "g", createdAt: 0, source: "user-edited", steps: [{ id: "1", title: "Read config", status: "pending", tool: "file-read" }] },
      });
      const seeded = events.flatMap((e) => (e._tag === "LedgerEntryAppended" ? [...e.entries] : [])).some((x) => JSON.stringify(x).includes("Read config"));
      expect(seeded).toBe(true);
      expect(result.plan?.steps.map((s) => s.id)).toEqual(["1"]);
    } finally {
      await agent.dispose();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30000);
});

describe("plan tool catalog (default on)", () => {
  const def = (name: string, description: string) => ({
    definition: { name, description, parameters: [], riskLevel: "low" as const, timeoutMs: 5_000, requiresApproval: false, source: "function" as const },
    handler: () => Effect.succeed("ok"),
  });

  test("agent.plan() shows the model the by-name catalog, MCP tools grouped by server", async () => {
    const captured: Req[] = [];
    const reply = "Plan:\n1. Find the issue (tool: github/list_issues)\n2. Look up the code (tool: repo-search)";
    const agent = await ReactiveAgents.create()
      .withName("plan-catalog")
      .withProvider("test")
      .withModel("test-model")
      .withReasoning({ defaultStrategy: "reactive" })
      .withTools({ tools: [def("repo-search", "Search the repo."), def("github/list_issues", "List issues."), def("github/get_pr", "Get a pull request.")] })
      .withReplayLLM(layerOf([{ text: reply }, { text: reply }], captured))
      .withMaxIterations(4)
      .build();
    try {
      const plan = await agent.plan("Fix the bug");
      const seen = JSON.stringify(captured.map((r) => [r.systemPrompt, r.messages]));
      expect(seen).toContain("Execute-phase tools");
      expect(seen).toContain("repo-search (Search the repo)");
      expect(seen).toContain("MCP github");
      expect(plan.steps.map((s) => s.tool)).toEqual(["github/list_issues", "repo-search"]);
    } finally {
      await agent.dispose();
    }
  }, 30000);

  test(".withHarness({ planToolCatalog: false }) leaves the catalog out", async () => {
    const captured: Req[] = [];
    const reply = "Plan:\n1. Look up the code (tool: repo-search)\n2. Fix it";
    const agent = await ReactiveAgents.create()
      .withName("plan-catalog-off")
      .withProvider("test")
      .withModel("test-model")
      .withReasoning({ defaultStrategy: "reactive" })
      .withHarness({ planToolCatalog: false })
      .withTools({ tools: [def("repo-search", "Search the repo."), def("github/list_issues", "List issues.")] })
      .withReplayLLM(layerOf([{ text: reply }, { text: reply }], captured))
      .withMaxIterations(4)
      .build();
    try {
      await agent.plan("Fix the bug");
      expect(JSON.stringify(captured.map((r) => [r.systemPrompt, r.messages]))).not.toContain("Execute-phase tools");
    } finally {
      await agent.dispose();
    }
  }, 30000);
});
