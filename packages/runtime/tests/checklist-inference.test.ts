/**
 * Inferred checklist progress (plan 2026-10-29 Part A, task A1): display-side only.
 * - unit: ChecklistUpdated rows carry source/evidence; `ChecklistInferred` published once per (item, evidence)
 * - e2e: request identity inference ON vs OFF (OFF = `observability.checklist:false`, no tracker at all),
 *   with a vacuity guard proving inference actually fired in the ON arm.
 *
 * Run: bun test packages/runtime/tests/checklist-inference.test.ts --timeout 20000
 */
import { describe, test, expect } from "bun:test";
import { Effect, Layer, Queue } from "effect";
import type { AgentEvent } from "@reactive-agents/core";
import { LLMService, TestLLMService } from "@reactive-agents/llm-provider";
import { ReactiveAgents } from "../src/builder.js";
import type { AgentStreamEvent } from "../src/stream-types.js";
import type { EbLike } from "../src/engine/runtime-context.js";
import { subscribeChecklistStream } from "../src/engine/checklist-stream.js";

type Checklist = Extract<AgentStreamEvent, { _tag: "ChecklistUpdated" }>;
type Req = import("@reactive-agents/llm-provider").CompletionRequest;

function fakeBus(published: AgentEvent[]): EbLike {
  const handlers = new Map<string, Array<(e: AgentEvent) => Effect.Effect<void, never>>>();
  return {
    publish: (e) => {
      published.push(e);
      return Effect.all((handlers.get(e._tag) ?? []).map((h) => h(e)), { discard: true });
    },
    on: ((tag: string, h: (e: AgentEvent) => Effect.Effect<void, never>) =>
      Effect.sync(() => {
        handlers.set(tag, [...(handlers.get(tag) ?? []), h]);
        return () => {};
      })) as EbLike["on"],
  };
}
const ledger = (entries: Record<string, unknown>[]) =>
  ({ _tag: "LedgerEntryAppended", agentId: "a", taskId: "root", entries, timestamp: 1 }) satisfies AgentEvent;

describe("subscribeChecklistStream — inferred progress", () => {
  test("snapshot rows carry source/evidence; ChecklistInferred published exactly once per pair", async () => {
    const published: AgentEvent[] = [];
    const eb = fakeBus(published);
    const q = await Effect.runPromise(Queue.unbounded<AgentStreamEvent>());
    await Effect.runPromise(subscribeChecklistStream(eb, q, "root"));
    const pub = (e: AgentEvent) => Effect.runPromise(eb.publish(e));
    await pub(ledger([{ kind: "checklist-item", seq: 1, iteration: 1, change: { op: "add", items: [{ id: "1", title: "Write ./a.md" }] } }]));
    await pub(ledger([
      { kind: "tool-invocation", seq: 2, iteration: 2, toolName: "file-write", args: { path: "./a.md" }, toolCallId: "c" },
      { kind: "tool-result", seq: 3, iteration: 2, toolCallId: "c", success: true, preview: "" },
    ]));
    // unrelated later batch must not re-announce
    await pub(ledger([{ kind: "checklist-item", seq: 4, iteration: 3, change: { op: "add", items: [{ id: "2", title: "other" }] } }]));
    const updates = [...(await Effect.runPromise(Queue.takeAll(q)))] as Checklist[];
    expect(updates[0]!.checklist.root.rows[0]).toMatchObject({ status: "pending", source: "explicit" });
    expect(updates[1]!.checklist.root.rows[0]).toMatchObject({
      status: "done", source: "inferred", evidence: { seq: 3, kind: "tool-result", detail: "file-write ./a.md" },
    });
    const inferred = published.filter((e) => e._tag === "ChecklistInferred");
    expect(inferred).toHaveLength(1);
    expect(inferred[0]).toMatchObject({ itemId: "1", groupKey: "root", evidence: { seq: 3 }, iteration: 2 });
  });

  test("unmarked item without evidence stays pending to the end (never force-completed)", async () => {
    const published: AgentEvent[] = [];
    const eb = fakeBus(published);
    const q = await Effect.runPromise(Queue.unbounded<AgentStreamEvent>());
    await Effect.runPromise(subscribeChecklistStream(eb, q, "root"));
    await Effect.runPromise(eb.publish(ledger([{ kind: "checklist-item", seq: 1, iteration: 1, change: { op: "add", items: [{ id: "1", title: "Ponder" }] } }])));
    await Effect.runPromise(eb.publish({ _tag: "AgentCompleted", taskId: "root", agentId: "a", success: true, totalTokens: 0, durationMs: 1, timestamp: 2 } as never));
    const updates = [...(await Effect.runPromise(Queue.takeAll(q)))] as Checklist[];
    expect(updates.at(-1)!.checklist.root.rows[0]).toMatchObject({ status: "pending", source: "explicit" });
    expect(published.some((e) => e._tag === "ChecklistInferred")).toBe(false);
  });
});

const SCENARIO = [
  { toolCall: { name: "todo", args: { action: "add", items: ["Run archive-report on ./inferred-out.txt", "Ponder the result"] } } },
  { toolCall: { name: "archive-report", args: { path: "./inferred-out.txt" } } },
  { text: "FINAL ANSWER: done" },
];

function capturingLayer(captured: Req[]): Layer.Layer<LLMService> {
  const base = TestLLMService(SCENARIO);
  return Layer.succeed(
    LLMService,
    LLMService.of({
      ...base,
      complete: (r) => { captured.push(r); return base.complete(r); },
      stream: (r) => { captured.push(r); return base.stream(r); },
    }),
  );
}
const project = (r: Req) => ({
  messages: r.messages, systemPrompt: r.systemPrompt, tools: r.tools, purpose: r.purpose,
  model: r.model, maxTokens: r.maxTokens, temperature: r.temperature, stopSequences: r.stopSequences,
});

async function runArm(checklist: boolean) {
  const captured: Req[] = [];
  const agent = await ReactiveAgents.create()
    .withName("checklist-inference")
    .withProvider("test")
    .withModel("test-model")
    .withReasoning()
    .withMetaTools({ todo: true, recall: true })
    .withTools({
      tools: [{
        definition: {
          name: "archive-report",
          description: "Archive a report file",
          parameters: [{ name: "path", type: "string" as const, description: "file path", required: true }],
          riskLevel: "low" as const,
          timeoutMs: 5_000,
          requiresApproval: false,
          source: "function" as const,
        },
        handler: () => Effect.succeed("archived"),
      }],
    })
    .withReplayLLM(capturingLayer(captured))
    .withObservability({ checklist })
    .withRequiredTools({ adaptive: false })
    .withMaxIterations(6)
    .build();
  try {
    const events: AgentStreamEvent[] = [];
    for await (const e of agent.runStream("plan and do the work", { density: "full" })) events.push(e);
    return { requests: captured.map(project), events };
  } finally {
    await agent.dispose();
  }
}

describe("inference is model-invisible", () => {
  test("LLM requests identical inference ON vs OFF; vacuity: it fired in the ON arm", async () => {
    const on = await runArm(true);
    const off = await runArm(false);
    // vacuity guard: the ON arm really inferred an item, the OFF arm has no checklist at all
    const rows = on.events
      .filter((e): e is Checklist => e._tag === "ChecklistUpdated")
      .flatMap((e) => e.checklist.root.rows);
    expect(rows.some((r) => r.source === "inferred" && r.status === "done" && r.evidence?.kind === "tool-result")).toBe(true);
    expect(rows.find((r) => r.title === "Ponder the result")?.status).toBe("pending");
    expect(off.events.some((e) => e._tag === "ChecklistUpdated")).toBe(false);
    expect(on.requests.length).toBeGreaterThan(1);
    expect(on.requests).toEqual(off.requests);
  });
});
