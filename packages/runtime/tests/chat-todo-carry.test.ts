/**
 * Conversation-level to-do list: a chat turn starts from the prior turn's list
 * (`SessionOptions.initialTodo` -> `RunEnvelopeRails.initialAdvisory`), and the
 * turn's final list is readable (`session.todo()`) and persistable
 * (`snapshotToTodoSeed`).
 *
 * Run: bun test packages/runtime/tests/chat-todo-carry.test.ts --timeout 30000
 */
import { describe, test, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { LLMService, TestLLMService } from "@reactive-agents/llm-provider";
import type { ChecklistSnapshot, Task } from "@reactive-agents/core";
import { ReactiveAgents } from "../src/builder.js";
import type { AgentStreamEvent } from "../src/stream-types.js";
import { snapshotToTodoSeed, todoSeedMetadata, readTodoSeed, type TodoSeedItem } from "../src/chat/todo-seed.js";
import { runReasoningHarnessHooks } from "../src/engine/phases/agent-loop/reasoning-harness-hooks.js";
import { runVerificationThinkRetry } from "../src/engine/phases/agent-loop/verification-think-retry.js";
import { defaultReactiveAgentsConfig } from "../src/types.js";
import type { ExecutionContext, ReactiveAgentsConfig } from "../src/types.js";
import type { ReasoningServiceLike } from "../src/engine/types-reasoning.js";

type Checklist = Extract<AgentStreamEvent, { _tag: "ChecklistUpdated" }>;
type Req = import("@reactive-agents/llm-provider").CompletionRequest;

const snap = (rows: ChecklistSnapshot["root"]["rows"]): ChecklistSnapshot => ({
  root: { key: "root", label: "root", rows, requirements: { done: 0, total: 0 }, advisory: { done: 0, total: 0 }, activeAdvisoryIds: [], children: [] },
  lastSeq: 0,
});

describe("todo-seed helpers (pure)", () => {
  test("snapshotToTodoSeed: advisory rows only, done -> completed, requirements dropped", () => {
    const seed = snapshotToTodoSeed(
      snap([
        { id: "answer", kind: "requirement", title: "answer the task", status: "pending" },
        { id: "1", kind: "advisory", title: "one", status: "done" },
        { id: "2", kind: "advisory", title: "two", status: "in_progress" },
        { id: "3", kind: "advisory", title: "three", status: "pending" },
      ]),
    );
    expect(seed).toEqual([
      { id: "1", title: "one", status: "completed" },
      { id: "2", title: "two", status: "in_progress" },
      { id: "3", title: "three", status: "pending" },
    ]);
  });

  test("snapshotToTodoSeed: harness plan rows (source \"plan\") are turn-scoped and never carried", () => {
    const seed = snapshotToTodoSeed(
      snap([
        { id: "1", kind: "advisory", title: "model todo", status: "pending", source: "explicit" },
        { id: "plan-1", kind: "advisory", title: "plan step one", status: "done", source: "plan" },
        { id: "plan-2", kind: "advisory", title: "plan step two", status: "pending", source: "plan" },
      ]),
    );
    expect(seed).toEqual([{ id: "1", title: "model todo", status: "pending" }]);
  });

  test("todoSeedMetadata/readTodoSeed round-trip; absent or empty => nothing (bytes identical)", () => {
    const seed: TodoSeedItem[] = [{ id: "1", title: "one", status: "pending" }];
    expect(readTodoSeed({ metadata: { tags: [], ...todoSeedMetadata(seed) } } as Pick<Task, "metadata">)).toEqual(seed);
    expect(todoSeedMetadata(undefined)).toEqual({});
    expect(todoSeedMetadata([])).toEqual({});
    expect(readTodoSeed({ metadata: { tags: [] } } as Pick<Task, "metadata">)).toBeUndefined();
    const junk = { metadata: { context: { initialTodo: [{ id: 1 }, { id: "x", title: "t", status: "bogus" }] } } } as never;
    expect(readTodoSeed(junk)).toBeUndefined();
  });
});

const TURN1 = [
  { toolCall: { name: "todo", args: { action: "add", items: ["step one", "step two", "step three"] } } },
  { toolCall: { name: "todo", args: { action: "done", id: 1 } } },
  { text: "FINAL ANSWER: turn one" },
];
const TURN2 = [
  { toolCall: { name: "todo", args: { action: "done", id: 2 } } },
  { toolCall: { name: "todo", args: { action: "add", items: ["step four"] } } },
  { text: "FINAL ANSWER: turn two" },
];

/** Both turns' scripted replies, served in order from one provider. */
function capturingLayer(captured: Req[]): Layer.Layer<LLMService> {
  const base = TestLLMService([...TURN1, ...TURN2]);
  return Layer.succeed(
    LLMService,
    LLMService.of({
      ...base,
      complete: (r) => (captured.push(r), base.complete(r)),
      stream: (r) => (captured.push(r), base.stream(r)),
    }),
  );
}

const build = (captured: Req[] = []) =>
  ReactiveAgents.create()
    .withName("chat-todo-carry")
    .withProvider("test")
    .withModel("test-model")
    .withReasoning()
    .withMetaTools({ todo: true, recall: true })
    .withReplayLLM(capturingLayer(captured))
    .withRequiredTools({ adaptive: false })
    .withMaxIterations(6)
    .build();

async function turn(session: ReturnType<Awaited<ReturnType<typeof build>>["session"]>, msg: string) {
  const events: AgentStreamEvent[] = [];
  for await (const e of session.runStream(msg, { density: "full" })) events.push(e);
  return events.filter((e): e is Checklist => e._tag === "ChecklistUpdated");
}
const advisory = (u: Checklist) => u.checklist.root.rows.filter((r) => r.kind === "advisory").map((r) => `${r.id}:${r.status}`);

describe("chat turns carry the conversation's to-do list (e2e, real runtime, test provider)", () => {
  test("turn 2 starts from turn 1's list: restored batch first, ids continue, done works on a seeded id", async () => {
    const agent = await build();
    try {
      const session = agent.session();
      const u1 = await turn(session, "plan three things");
      expect(advisory(u1[u1.length - 1]!)).toEqual(["1:done", "2:pending", "3:pending"]);
      const persisted = session.todo();
      expect(persisted).toEqual([
        { id: "1", title: "step one", status: "completed" },
        { id: "2", title: "step two", status: "pending" },
        { id: "3", title: "step three", status: "pending" },
      ]);

      const u2 = await turn(session, "continue");
      // First snapshot of turn 2 is the seeded list (iteration 0), before the model acts.
      expect(u2[0]!.iteration).toBe(0);
      expect(advisory(u2[0]!)).toEqual(["1:done", "2:pending", "3:pending"]);
      // `done 2` worked on the seeded id; `add` continued numbering at 4.
      expect(advisory(u2[u2.length - 1]!)).toEqual(["1:done", "2:done", "3:pending", "4:pending"]);
      expect(session.todo().map((t) => `${t.id}:${t.status}`)).toEqual(["1:completed", "2:completed", "3:pending", "4:pending"]);
    } finally {
      await agent.dispose();
    }
  }, 60000);

  test("a host-persisted list resumes a fresh session (SessionOptions.initialTodo)", async () => {
    const agent = await build();
    try {
      const seed: TodoSeedItem[] = [
        { id: "1", title: "step one", status: "completed" },
        { id: "2", title: "step two", status: "pending" },
        { id: "3", title: "step three", status: "pending" },
      ];
      const session = agent.session({ initialTodo: seed });
      expect(session.todo()).toEqual(seed);
      // Skip turn-1's script by consuming it first through a throwaway session.
      await turn(agent.session(), "burn turn one script");
      const u = await turn(session, "continue");
      expect(advisory(u[0]!)).toEqual(["1:done", "2:pending", "3:pending"]);
      expect(advisory(u[u.length - 1]!)).toEqual(["1:done", "2:done", "3:pending", "4:pending"]);
    } finally {
      await agent.dispose();
    }
  }, 60000);

  test("absent seed: bytes identical — a fresh session's first turn requests equal a plain runStream's", async () => {
    const a: Req[] = [];
    const b: Req[] = [];
    const agentA = await build(a);
    const agentB = await build(b);
    try {
      await turn(agentA.session(), "plan three things");
      for await (const _ of agentB.runStream("plan three things", { density: "full" })) void _;
      const strip = (rs: Req[]) => JSON.stringify(rs.map((r) => ({ m: r.messages, s: r.systemPrompt, t: r.tools })));
      expect(strip(a)).toBe(strip(b));
    } finally {
      await agentA.dispose();
      await agentB.dispose();
    }
  }, 60000);

  test("seeded list is display-only: the model's prompt never contains it before it calls `todo`", async () => {
    const captured: Req[] = [];
    const agent = await build(captured);
    try {
      const session = agent.session({
        initialTodo: [{ id: "1", title: "UNIQUE-SEED-TITLE", status: "pending" }],
      });
      await turn(session, "continue");
      const first = captured[0]!;
      expect(JSON.stringify([first.messages, first.systemPrompt])).not.toContain("UNIQUE-SEED-TITLE");
    } finally {
      await agent.dispose();
    }
  }, 60000);
});

// ── Auxiliary passes are not re-seeded ──────────────────────────────────────

type ExecuteRequest = Parameters<ReasoningServiceLike["execute"]>[0];

const seededTask = {
  id: "t1",
  type: "analysis",
  input: "write the report",
  priority: "normal",
  metadata: { tags: [], ...todoSeedMetadata([{ id: "1", title: "carried", status: "pending" }]) },
  createdAt: new Date(),
} as never as Task;

const makeCtx = (): ExecutionContext =>
  ({
    taskId: "t1", agentId: "a1", sessionId: "s1", phase: "think", agentState: "running",
    iteration: 1, maxIterations: 4, messages: [{ role: "user", content: "write the report" }],
    toolResults: [], cost: 0, tokensUsed: 0, startedAt: new Date(), selectedStrategy: "reactive",
    metadata: { lastResponse: "The report is written." },
  }) as never as ExecutionContext;

const recordingService = (sink: ExecuteRequest[]): ReasoningServiceLike =>
  ({
    execute: (params: ExecuteRequest) => {
      sink.push(params);
      return Effect.succeed({
        strategy: "reactive", steps: [], output: "refined answer", status: "completed",
        metadata: { duration: 0, cost: 0, tokensUsed: 0, stepsCount: 0, confidence: 0.8 },
      });
    },
    registerStrategy: () => Effect.void,
  }) as never as ReasoningServiceLike;

const cfg = (over: Partial<ReactiveAgentsConfig>): ReactiveAgentsConfig => ({
  ...defaultReactiveAgentsConfig("a1"), provider: "test", fabricationGuard: "block", ...over,
});

describe("auxiliary passes do not re-seed the to-do list", () => {
  test("continuation and verification-retry envelopes carry no initialAdvisory even when the task is seeded", async () => {
    const seen: ExecuteRequest[] = [];
    await Effect.runPromise(
      runReasoningHarnessHooks(makeCtx(), {
        config: cfg({ customTermination: () => false }),
        task: seededTask,
        cacheHit: false,
        reasoningOpt: { _tag: "Some", value: recordingService(seen) },
        availableToolNames: ["file-write"], availableToolSchemas: [], allToolSchemas: [],
        effectiveRequiredTools: ["file-write"], effectiveRequiredToolQuantities: undefined,
        classifiedRelevantTools: undefined, autoMaxCallsPerTool: {}, taskCategory: "general",
        resolvedCalibration: undefined, obs: null,
      }),
    );
    await Effect.runPromise(
      runVerificationThinkRetry(makeCtx(), {
        config: cfg({}), task: seededTask,
        reasoningOpt: { _tag: "Some", value: recordingService(seen) },
        taskCategory: "general", resolvedCalibration: undefined, obs: null, eb: null,
      }),
    );
    expect(seen.length).toBeGreaterThanOrEqual(2);
    for (const r of seen) expect(r.envelope?.rails.initialAdvisory).toBeUndefined();
  });
});
