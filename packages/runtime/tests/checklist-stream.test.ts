/**
 * `ChecklistUpdated` stream projection (plan-and-goal-primitives Task 6):
 * ledger facts -> core makeChecklistTracker -> AgentStream, full density only.
 *
 * Run: bun test packages/runtime/tests/checklist-stream.test.ts --timeout 20000
 */
import { describe, test, expect } from "bun:test";
import { Effect, Queue } from "effect";
import { EventBus, EventBusLive, type AgentEvent, type Task, type TaskResult } from "@reactive-agents/core";
import { ReactiveAgents } from "../src/builder.js";
import type { AgentStreamEvent } from "../src/stream-types.js";
import type { EbLike } from "../src/engine/runtime-context.js";
import { makeExecuteStream } from "../src/engine/execute-stream.js";
import { subscribeChecklistStream, toChecklistStreamEvent } from "../src/engine/checklist-stream.js";

type Checklist = Extract<AgentStreamEvent, { _tag: "ChecklistUpdated" }>;
type Activity = Extract<AgentStreamEvent, { _tag: "SubAgentActivity" }>;

/** Minimal in-memory bus: `publish` runs every handler registered for the tag. */
function fakeBus(): EbLike {
  const handlers = new Map<string, Array<(e: AgentEvent) => Effect.Effect<void, never>>>();
  return {
    publish: (e) => Effect.all((handlers.get(e._tag) ?? []).map((h) => h(e)), { discard: true }),
    on: ((tag: string, h: (e: AgentEvent) => Effect.Effect<void, never>) =>
      Effect.sync(() => {
        handlers.set(tag, [...(handlers.get(tag) ?? []), h]);
        return () => {};
      })) as EbLike["on"],
  };
}

const req = (seq: number, status: "declared" | "satisfied", extra: Record<string, unknown> = {}) => ({
  kind: "requirement", seq, iteration: seq, requirementId: "answer", status,
  description: "answer the task", requirementKind: "question-answered", ...extra,
});
const ledger = (taskId: string, entries: Record<string, unknown>[], restored?: true) =>
  ({ _tag: "LedgerEntryAppended", agentId: "a", taskId, entries, ...(restored ? { restored } : {}), timestamp: 1 }) satisfies AgentEvent;

async function harness() {
  const eb = fakeBus();
  const q = await Effect.runPromise(Queue.unbounded<AgentStreamEvent>());
  await Effect.runPromise(subscribeChecklistStream(eb, q, "root"));
  const pub = (e: AgentEvent) => Effect.runPromise(eb.publish(e));
  const drain = async (): Promise<Checklist[]> => {
    const out = await Effect.runPromise(Queue.takeAll(q));
    return [...out] as Checklist[];
  };
  return { pub, drain };
}

describe("subscribeChecklistStream (unit)", () => {
  test("one update per changed snapshot; unchanged emits nothing", async () => {
    const { pub, drain } = await harness();
    await pub(ledger("root", [req(0, "declared")]));
    await pub(ledger("root", [{ kind: "tool-invocation", seq: 1, iteration: 1 }]));
    await pub(ledger("root", [req(2, "satisfied")]));
    const ev = await drain();
    expect(ev.map((e) => e._tag)).toEqual(["ChecklistUpdated", "ChecklistUpdated"]);
    expect(ev[0]!.checklist.root.requirements).toEqual({ done: 0, total: 1 });
    expect(ev[1]!.checklist.root.requirements).toEqual({ done: 1, total: 1 });
  });

  test("restored batch reseeds (replaces, not appends)", async () => {
    const { pub, drain } = await harness();
    await pub(ledger("root", [req(0, "declared")]));
    await drain();
    await pub(ledger("root", [req(0, "declared"), req(1, "satisfied")], true));
    const ev = await drain();
    expect(ev).toHaveLength(1);
    expect(ev[0]!.checklist.root.requirements).toEqual({ done: 1, total: 1 });
  });

  test("foreign taskId is ignored", async () => {
    const { pub, drain } = await harness();
    await pub(ledger("someone-else", [req(0, "declared")]));
    expect(await drain()).toEqual([]);
  });

  test("toChecklistStreamEvent carries snapshot and iteration", () => {
    const snap = { root: { key: "root", label: "root", rows: [], requirements: { done: 0, total: 0 }, advisory: { done: 0, total: 0 }, activeAdvisoryIds: [], children: [] }, lastSeq: 0 };
    expect(toChecklistStreamEvent(snap, 3)).toEqual({ _tag: "ChecklistUpdated", checklist: snap, iteration: 3 });
  });
});

const TODO_TOOL_SCENARIO = [
  { toolCall: { name: "todo", args: { action: "add", items: ["step one", "step two"] } } },
  { toolCall: { name: "todo", args: { action: "done", id: 1 } } },
  { toolCall: { name: "todo", args: { action: "done", id: 2 } } },
  { text: "FINAL ANSWER: done" },
];

async function runTodo(opts: { density: "tokens" | "full"; checklist?: boolean }) {
  const b = ReactiveAgents.create()
    .withName("checklist-e2e")
    .withProvider("test")
    .withReasoning()
    .withMetaTools({ todo: true, brief: true, find: true, pulse: true, recall: true, checkpoint: true } as never)
    .withTestScenario(TODO_TOOL_SCENARIO)
    .withRequiredTools({ adaptive: false })
    .withMaxIterations(6);
  const agent = await (opts.checklist === undefined ? b : b.withObservability({ checklist: opts.checklist })).build();
  try {
    const events: AgentStreamEvent[] = [];
    for await (const e of agent.runStream("plan and do two things", { density: opts.density })) events.push(e);
    return events;
  } finally {
    await agent.dispose();
  }
}

describe("runStream — ChecklistUpdated (e2e)", () => {
  test("full density: ordered updates, last before StreamCompleted, advisory never decides done-ness", async () => {
    const events = await runTodo({ density: "full" });
    const updates = events.filter((e): e is Checklist => e._tag === "ChecklistUpdated");
    expect(updates.length).toBeGreaterThan(0);
    const lastIdx = events.map((e) => e._tag).lastIndexOf("ChecklistUpdated");
    expect(lastIdx).toBeLessThan(events.findIndex((e) => e._tag === "StreamCompleted"));
    const seqs = updates.map((u) => u.checklist.lastSeq);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
    const first = updates.find((u) => u.checklist.root.rows.length > 0)!.checklist.root;
    expect(first.rows.some((r) => r.kind === "requirement")).toBe(true);
    for (const row of first.rows.filter((r) => r.kind === "requirement")) expect(row.title.length).toBeGreaterThan(0);
    // Review Focus 1: every advisory item ticked, but the gate decides done-ness.
    const final = updates[updates.length - 1]!.checklist.root;
    expect(final.advisory.total).toBe(2);
    expect(final.advisory.done).toBe(2);
    expect(final.requirements.done).toBeLessThanOrEqual(final.requirements.total);
    // advisory rows never count toward requirements
    expect(final.requirements.total).toBe(final.rows.filter((r) => r.kind === "requirement").length);
  }, 30000);

  test("Review Focus 1: advisory all ticked while a contract requirement stays unsatisfied => root.requirements.done < total", async () => {
    const agent = await ReactiveAgents.create()
      .withName("checklist-gate")
      .withProvider("test")
      .withReasoning()
      .withMetaTools({ todo: true, brief: true, find: true, pulse: true, recall: true, checkpoint: true } as never)
      .withTestScenario([
        { toolCall: { name: "todo", args: { action: "add", items: ["only item"] } } },
        { toolCall: { name: "todo", args: { action: "done", id: 1 } } },
        { text: "FINAL ANSWER: done" },
      ])
      .withRequiredTools({ adaptive: false })
      .withMaxIterations(5)
      .build();
    try {
      const updates: Checklist[] = [];
      for await (const e of agent.runStream("Write a summary to ra-checklist-never-written.txt using file-write, then finish", { density: "full" })) {
        if (e._tag === "ChecklistUpdated") updates.push(e);
      }
      const final = updates[updates.length - 1]!.checklist.root;
      expect(final.advisory).toEqual({ done: 1, total: 1 });
      expect(final.requirements.total).toBeGreaterThan(0);
      expect(final.requirements.done).toBeLessThan(final.requirements.total);
    } finally {
      await agent.dispose();
    }
  }, 30000);

  // D9 P7: a plan-execute run streams its plan as checklist rows (source "plan")
  // the harness advances from plan state — no `todo` tool in the run.
  test("plan-execute: plan steps stream live as plan rows, pending to done, with no todo call", async () => {
    const agent = await ReactiveAgents.create()
      .withName("checklist-plan")
      .withProvider("test")
      .withReasoning({ defaultStrategy: "plan-execute-reflect" })
      .withTestScenario([
        { json: { steps: [
          { title: "Gather facts", instruction: "list the ALPHA facts", type: "analysis" },
          { title: "Write summary", instruction: "summarize the BETA facts", type: "analysis", dependsOn: ["s1"] },
        ] } },
        { match: "ALPHA facts", text: "FINAL ANSWER: alpha facts listed." },
        { match: "BETA facts", text: "FINAL ANSWER: beta summary." },
        { match: "GOAL:", text: "SATISFIED: complete." },
        { text: "The final summary." },
      ])
      .build();
    try {
      const updates: Checklist[] = [];
      for await (const e of agent.runStream("Summarize the findings in two parts.", { density: "full" })) {
        if (e._tag === "ChecklistUpdated") updates.push(e);
      }
      const planRows = (u: Checklist) => u.checklist.root.rows.filter((r) => r.source === "plan").map((r) => [r.title, r.status]);
      const seen = updates.map(planRows).filter((rows) => rows.length > 0);
      // Live: the first plan snapshot shows step 1 running before it completes.
      expect(seen[0]).toEqual([["Gather facts", "in_progress"], ["Write summary", "pending"]]);
      expect(seen[seen.length - 1]).toEqual([["Gather facts", "done"], ["Write summary", "done"]]);
      expect(updates.flatMap((u) => u.checklist.root.rows).some((r) => r.source === "explicit")).toBe(false);
    } finally {
      await agent.dispose();
    }
  }, 30000);

  // Strategy-neutral stream: a strategy's control narration ([PLAN n], [REFLECT n],
  // [EXEC ...], raw plan JSON) never reaches the thinking stream; thoughts are
  // kernel turns only (engine/strategy-neutral-stream.ts).
  test("plan-execute: no strategy control marker streams as ThoughtEmitted", async () => {
    const agent = await ReactiveAgents.create()
      .withName("thought-plan")
      .withProvider("test")
      .withReasoning({ defaultStrategy: "plan-execute-reflect" })
      .withTestScenario([
        { json: { steps: [
          { title: "Gather facts", instruction: "list the ALPHA facts", type: "analysis" },
          { title: "Write summary", instruction: "summarize the BETA facts", type: "analysis", dependsOn: ["s1"] },
        ] } },
        { match: "ALPHA facts", text: "FINAL ANSWER: alpha facts listed." },
        { match: "BETA facts", text: "FINAL ANSWER: beta summary." },
        { match: "GOAL:", text: "SATISFIED: complete." },
        { text: "The final summary." },
      ])
      .build();
    try {
      const events: AgentStreamEvent[] = [];
      for await (const e of agent.runStream("Summarize the findings in two parts.", { density: "full" })) events.push(e);
      expect(events.some((e) => e._tag === "StreamCompleted")).toBe(true);
      const thoughts = events.flatMap((e) => (e._tag === "ThoughtEmitted" ? [e.content] : []));
      expect(thoughts.filter((t) => /^\[[A-Z]/.test(t) || t.startsWith("{"))).toEqual([]);
    } finally {
      await agent.dispose();
    }
  }, 30000);

  // The shared exit gate's decision reaches the stream as one event, whatever strategy ran.
  test("plan-execute: a named file never written streams ExitGateDecision repair, then handoff", async () => {
    const file = "ra-exit-gate-stream-never-written-3b8d.md";
    const agent = await ReactiveAgents.create()
      .withName("exit-gate-stream")
      .withProvider("test")
      .withReasoning({ defaultStrategy: "plan-execute-reflect" })
      .withTestScenario([
        { json: { steps: [
          { title: "Gather facts", instruction: "list the ALPHA facts", type: "analysis" },
          { title: "Summarize", instruction: "summarize the BETA facts", type: "analysis", dependsOn: ["s1"] },
        ] } },
        { match: "ALPHA facts", text: "FINAL ANSWER: alpha facts listed." },
        { match: "BETA facts", text: "FINAL ANSWER: beta summary." },
        { match: "GOAL:", text: "SATISFIED: complete." },
        { match: "REFLECTION FEEDBACK", json: { steps: [{ title: "More", instruction: "restate the GAMMA facts", type: "analysis" }] } },
        { match: "GAMMA facts", text: "FINAL ANSWER: gamma restated." },
        { match: "GOAL:", text: "SATISFIED: complete." },
        { text: "The final summary." },
      ])
      .build();
    try {
      const gates: Extract<AgentStreamEvent, { _tag: "ExitGateDecision" }>[] = [];
      for await (const e of agent.runStream(`Summarize the findings and write them to ${file}`, { density: "full" })) {
        if (e._tag === "ExitGateDecision") gates.push(e);
      }
      expect(gates.map((g) => g.decision)).toEqual(["repair", "handoff"]);
      expect(gates[1]!.outstanding.some((o) => o.includes(file))).toBe(true);
    } finally {
      await agent.dispose();
    }
  }, 30000);

  test('density "tokens" emits no ChecklistUpdated', async () => {
    const events = await runTodo({ density: "tokens" });
    expect(events.some((e) => e._tag === "ChecklistUpdated")).toBe(false);
  }, 30000);

  test("checklist:false emits no ChecklistUpdated even at full density", async () => {
    const events = await runTodo({ density: "full", checklist: false });
    expect(events.some((e) => e._tag === "ChecklistUpdated")).toBe(false);
  }, 30000);

  test("delegation: parent with spawned sub-agents and an accepted answer shows its own answer requirement satisfied", async () => {
    const agent = await ReactiveAgents.create()
      .withName("checklist-deleg-answer")
      .withProvider("test")
      .withTools()
      .withDynamicSubAgents({ maxIterations: 3 })
      .withTestScenario([
        { toolCall: { name: "spawn-agent", args: { task: "do a", name: "alpha" } } },
        { toolCall: { name: "spawn-agent", args: { task: "do b", name: "beta" } } },
        { text: "FINAL ANSWER: Paris 72" },
      ])
      .withRequiredTools({ adaptive: false })
      .withMaxIterations(6)
      .build();
    try {
      const updates: Checklist[] = [];
      for await (const e of agent.runStream("go", { density: "full" })) {
        if (e._tag === "ChecklistUpdated") updates.push(e);
      }
      const final = updates[updates.length - 1]!.checklist.root;
      expect(final.requirements).toEqual({ done: 1, total: 1 });
    } finally {
      await agent.dispose();
    }
  }, 30000);

  test("delegation: two parallel children -> two child groups, root done-ness ignores them, no duplicates", async () => {
    const agent = await ReactiveAgents.create()
      .withName("checklist-deleg")
      .withProvider("test")
      .withTools()
      .withDynamicSubAgents({ maxIterations: 3 })
      .withTestScenario([
        { toolCall: { name: "spawn-agents", args: { tasks: [{ task: "do a", name: "alpha" }, { task: "do b", name: "beta" }] } } },
        { text: "FINAL ANSWER: child done" },
      ])
      .withRequiredTools({ adaptive: false })
      .withMaxIterations(4)
      .build();
    try {
      const events: AgentStreamEvent[] = [];
      for await (const e of agent.runStream("go", { density: "full" })) events.push(e);
      const updates = events.filter((e): e is Checklist => e._tag === "ChecklistUpdated");
      // never wrapped as sub-agent activity: the tracker owns the tree
      expect(events.filter((e): e is Activity => e._tag === "SubAgentActivity").some((a) => a.event._tag === "ChecklistUpdated")).toBe(false);
      expect(updates.length).toBeGreaterThan(0);
      const sawLive = updates.some((u) => u.checklist.root.children.some((c) => c.live === true));
      expect(sawLive).toBe(true);
      const maxLiveSiblings = Math.max(...updates.map((u) => u.checklist.root.children.filter((c) => c.live === true).length));
      expect(maxLiveSiblings).toBe(2);
      const final = updates[updates.length - 1]!.checklist.root;
      expect(final.children.map((c) => c.label).sort()).toEqual(["alpha", "beta"]);
      expect(final.children.every((c) => c.live !== true)).toBe(true);
      const rootReqIds = final.rows.filter((r) => r.kind === "requirement").map((r) => r.id);
      expect(new Set(rootReqIds).size).toBe(rootReqIds.length);
      expect(final.requirements.total).toBe(rootReqIds.length);
    } finally {
      await agent.dispose();
    }
  }, 60000);
});

describe("makeExecuteStream — restored ledger batches", () => {
  test("a restored batch is not re-emitted as LedgerEntry chunks but reseeds the checklist", async () => {
    const task = { id: "t-restored", input: "x" } as never as Task;
    const execute = (_t: Task) =>
      Effect.gen(function* () {
        const eb = yield* EventBus;
        yield* eb.publish(ledger("t-restored", [req(0, "declared"), req(1, "satisfied")], true));
        yield* eb.publish(ledger("t-restored", [req(2, "declared", { requirementId: "b" })]));
        return { output: "ok", success: true, metadata: {}, taskId: "t-restored" } as never as TaskResult;
      });
    const config = { agentId: "a" } as never;
    const events = await Effect.runPromise(
      Effect.gen(function* () {
        const stream = yield* makeExecuteStream({ config, execute: execute as never })(task, { density: "full" });
        const { Stream } = yield* Effect.promise(() => import("effect"));
        return Array.from(yield* Stream.runCollect(stream));
      }).pipe(Effect.provide(EventBusLive)),
    );
    const chunks = events.filter((e) => e._tag === "LedgerEntry") as Array<{ seq: number }>;
    expect(chunks.map((c) => c.seq)).toEqual([2]);
    const updates = events.filter((e): e is Checklist => e._tag === "ChecklistUpdated");
    expect(updates).toHaveLength(2);
    expect(updates[0]!.checklist.root.requirements).toEqual({ done: 1, total: 1 });
    expect(updates[1]!.checklist.root.requirements).toEqual({ done: 1, total: 2 });
  });
});
