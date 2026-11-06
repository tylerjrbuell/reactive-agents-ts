// Run: bun test packages/reasoning/tests/kernel/seam-tool-call-refusals.test.ts --timeout 20000
//
// No tool call the model emits is dropped silently. H3 at 77b6d6122 (ledger
// entry 23): `harness:tool-call-dropped` 1->8. The think-phase tool gate
// (decide/tool-gating.ts) kept calls out of Act with no event and nothing in the
// thread, so the model re-emitted file-read(notes-4) three times and looped to
// dispatcher_early_stop (trace 01M6PZXKTQ702MXMXRJ1662NDN). Every refusal now
// yields a `guard-fired{guard:"tool-gate"}` event, a guard observation step
// (harness-authored, never tool evidence) and a `tool_result` answering that
// call in the provider thread (decide/tool-call-refusals.ts).
//
// RED-ON-CUT (each shown during the mission, then restored):
//   - drop `yield* emitRefusals(...)` in gateTurnToolCalls: (a)/(b)/(c) fail on
//     the missing guard-fired events;
//   - drop the `refusedCallsOfTurn` push in act/conversation-assembly.ts: (b)
//     and (c) fail (deferred calls have no tool_result in the thread);
//   - restore the old fall-through on a turn gated to zero in
//     dispatch-think-response.ts: (a) and (c) fail (the model never sees it).
// On the pre-fix gate the unit table fails too (`refused` did not exist).
import { describe, it, expect } from "bun:test";
import { Effect, Layer, Ref } from "effect";
import { TestLLMServiceLayer, type TestTurn } from "@reactive-agents/llm-provider";
import { EventBus, EventBusLive, type AgentEvent } from "@reactive-agents/core";
import { reactKernel } from "../../src/kernel/loop/react-kernel.js";
import { runPass } from "../../src/kernel/loop/run-pass.js";
import { mockToolServiceLayer } from "../../src/testing/tool-service-mock.js";
import { gateNativeToolCallsForRequiredTools } from "../../src/kernel/capabilities/decide/tool-gating.js";
import { GUARD_OBSERVATION_TAG } from "../../src/kernel/state/kernel-constants.js";
import type { KernelInput, KernelMessage } from "../../src/kernel/state/kernel-state.js";

const schema = (name: string, param: string) => ({
  name,
  description: `${name} tool`,
  parameters: [{ name: param, type: "string", required: true }],
});
const SEARCH = schema("web-search", "query");
const WRITE = { ...schema("file-write", "path"), parameters: [{ name: "path", type: "string", required: true }, { name: "content", type: "string", required: true }] };

type GuardEvent = Extract<AgentEvent, { _tag: "GuardFiredEmitted" }>;
type StartEvent = Extract<AgentEvent, { _tag: "ToolCallStarted" }>;

/** Run the real react kernel, recording bus events and per-call tool executions. */
async function run(input: KernelInput, turns: TestTurn[]) {
  const executed: string[] = [];
  const tools = mockToolServiceLayer({
    execute: (req) =>
      Effect.sync(() => {
        executed.push(req.toolName);
        return { success: true, result: { ok: true, tool: req.toolName } };
      }),
  });
  const { pass, events } = await Effect.runPromise(
    Effect.gen(function* () {
      const log = yield* Ref.make<AgentEvent[]>([]);
      const bus = yield* EventBus;
      yield* bus.subscribe((ev) => Ref.update(log, (xs) => [...xs, ev]));
      const pass = yield* runPass(reactKernel, input, { maxIterations: 6, strategy: "reactive", kernelType: "react", taskId: "refusals" });
      return { pass, events: yield* Ref.get(log) };
    }).pipe(Effect.provide(Layer.mergeAll(TestLLMServiceLayer(turns), tools, EventBusLive))),
  );
  const refusals = events.filter((e): e is GuardEvent => e._tag === "GuardFiredEmitted" && e.guard === "tool-gate");
  const started = events.filter((e): e is StartEvent => e._tag === "ToolCallStarted");
  return { pass, executed, refusals, started };
}

const refusalMeta = (e: GuardEvent) => e.metadata as { toolName: string; toolCallId: string; kind: string };
const resultFor = (messages: readonly KernelMessage[], id: string) =>
  messages.find((m): m is Extract<KernelMessage, { role: "tool_result" }> => m.role === "tool_result" && m.toolCallId === id);

describe("tool gate — refused calls are visible", () => {
  it("(a) a call over a user-set maxCallsPerTool: guard-fired + an answer the next think turn sees", async () => {
    const { pass, executed, refusals } = await run(
      { task: "Look up the answer with web-search", availableToolSchemas: [SEARCH], maxCallsPerTool: { "web-search": 1 } },
      [
        { toolCall: { id: "s1", name: "web-search", args: { query: "a" } } },
        { toolCall: { id: "s2", name: "web-search", args: { query: "b" } } },
        // Fires only when the refusal reached the model's next request.
        { match: "web-search was not run: its per-tool call budget is used up", text: "FINAL ANSWER: saw the refusal, the answer is ok." },
        { text: "FINAL ANSWER: never told, the answer is ok." },
      ],
    );
    expect(executed).toEqual(["web-search"]);
    expect(refusals.map(refusalMeta)).toEqual([{ toolName: "web-search", toolCallId: "s2", kind: "budget-exhausted" }]);
    expect(resultFor(pass.messages, "s2")?.content).toContain("web-search was not run: its per-tool call budget is used up (1 of 1 calls)");
    expect(pass.output).toContain("saw the refusal");
    // Harness-authored: the refusal is not tool evidence.
    const obs = pass.steps.find((s) => s.type === "observation" && s.metadata?.toolCallId === "s2");
    expect(obs?.metadata?.frameworkInstrumentation).toBe(GUARD_OBSERVATION_TAG);
    expect(pass.state.evidence.successfulCounts["web-search"]).toBe(1);
    expect(pass.state.evidence.attemptedCounts["web-search"]).toBe(1);
  }, 20000);

  it("(b) required-tool steering: every call outside the first required batch is answered, in the same assistant turn", async () => {
    const { pass, executed, refusals } = await run(
      { task: "Write a.md and b.md", availableToolSchemas: [WRITE, SEARCH], requiredTools: ["file-write"] },
      [
        {
          toolCalls: [
            { id: "w1", name: "file-write", args: { path: "a.md", content: "A" } },
            { id: "w2", name: "file-write", args: { path: "b.md", content: "B" } },
            { id: "s1", name: "web-search", args: { query: "x" } },
          ],
        },
        { text: "FINAL ANSWER: wrote a.md." },
      ],
    );
    expect(executed).toEqual(["file-write"]);
    expect(refusals.map(refusalMeta)).toEqual([
      { toolName: "file-write", toolCallId: "w2", kind: "deferred-required-batch" },
      { toolName: "web-search", toolCallId: "s1", kind: "required-first" },
    ]);
    const turn = pass.messages.find((m) => m.role === "assistant" && (m.toolCalls ?? []).some((c) => c.id === "w1"));
    expect(turn?.role === "assistant" ? (turn.toolCalls ?? []).map((c) => c.id).sort() : []).toEqual(["s1", "w1", "w2"]);
    expect(resultFor(pass.messages, "w2")?.content).toContain("file-write was not run: one batch of required-tool calls runs per turn");
    expect(resultFor(pass.messages, "s1")?.content).toContain("web-search was not run: required tool(s) file-write are still missing");
  }, 20000);

  it("(c) drift census: emitted calls == executed + refused-with-answer, disjoint", async () => {
    const emitted = ["w1", "w2", "s1", "s2", "s3"];
    const { pass, refusals, started } = await run(
      { task: "Write a.md, then look things up", availableToolSchemas: [WRITE, SEARCH], requiredTools: ["file-write"], maxCallsPerTool: { "web-search": 1 } },
      [
        {
          toolCalls: [
            { id: "w1", name: "file-write", args: { path: "a.md", content: "A" } },
            { id: "w2", name: "file-write", args: { path: "b.md", content: "B" } },
            { id: "s1", name: "web-search", args: { query: "x" } },
          ],
        },
        { toolCall: { id: "s2", name: "web-search", args: { query: "y" } } },
        { toolCall: { id: "s3", name: "web-search", args: { query: "z" } } },
        { text: "FINAL ANSWER: done." },
      ],
    );
    const ran = started.map((e) => e.callId);
    const refused = refusals.map((e) => refusalMeta(e).toolCallId).filter((id) => resultFor(pass.messages, id) !== undefined);
    expect([...ran, ...refused].sort()).toEqual([...emitted].sort());
    expect(new Set([...ran, ...refused]).size).toBe(emitted.length);
    expect(refusals.map((e) => refusalMeta(e).kind)).toEqual(["deferred-required-batch", "required-first", "budget-exhausted"]);
  }, 20000);
});

// maxCallsPerTool counts calls admitted earlier in the SAME turn, not only
// prior turns: a parallel batch cannot overrun a user-set cap.
// RED-ON-CUT: drop the `admitted` tally in the budget pre-filter of
// gateNativeToolCallsForRequiredTools: (a) and (b) fail (both calls run); (c) stays green.
describe("maxCallsPerTool — the cap holds inside one turn", () => {
  const two = (a: string, b: string) => ({
    toolCalls: [
      { id: a, name: "web-search", args: { query: a } },
      { id: b, name: "web-search", args: { query: b } },
    ],
  });

  it("(a) cap 1, no prior calls, two calls in one turn: one runs, one refused with an answered tool_result", async () => {
    const { pass, executed, refusals } = await run(
      { task: "Look things up with web-search", availableToolSchemas: [SEARCH], maxCallsPerTool: { "web-search": 1 } },
      [two("s1", "s2"), { text: "FINAL ANSWER: done." }],
    );
    expect(executed).toEqual(["web-search"]);
    expect(refusals.map(refusalMeta)).toEqual([{ toolName: "web-search", toolCallId: "s2", kind: "budget-exhausted" }]);
    expect(resultFor(pass.messages, "s2")?.content).toContain("web-search was not run: its per-tool call budget is used up (1 of 1 calls)");
    expect(pass.state.evidence.successfulCounts["web-search"]).toBe(1);
  }, 20000);

  it("(b) cap 2, one prior call, two calls in one turn: one runs, one refused", async () => {
    const { pass, executed, refusals } = await run(
      { task: "Look things up with web-search", availableToolSchemas: [SEARCH], maxCallsPerTool: { "web-search": 2 } },
      [{ toolCall: { id: "s0", name: "web-search", args: { query: "s0" } } }, two("s1", "s2"), { text: "FINAL ANSWER: done." }],
    );
    expect(executed).toEqual(["web-search", "web-search"]);
    expect(refusals.map(refusalMeta)).toEqual([{ toolName: "web-search", toolCallId: "s2", kind: "budget-exhausted" }]);
    expect(resultFor(pass.messages, "s2")?.content).toContain("(2 of 2 calls)");
    expect(pass.state.evidence.successfulCounts["web-search"]).toBe(2);
  }, 20000);

  it("(c) control: no cap, both calls in one turn run", async () => {
    const { executed, refusals } = await run(
      { task: "Look things up with web-search", availableToolSchemas: [SEARCH] },
      [two("s1", "s2"), { text: "FINAL ANSWER: done." }],
    );
    expect(executed).toEqual(["web-search", "web-search"]);
    expect(refusals).toEqual([]);
  }, 20000);

  it("unit: same-turn calls count against the cap; other tools are untouched", () => {
    const c = (id: string, name: string) => ({ id, name });
    const r = gateNativeToolCallsForRequiredTools(
      [c("1", "web-search"), c("2", "http-get"), c("3", "web-search"), c("4", "web-search")],
      [],
      new Set(),
      undefined,
      { "web-search": 1 },
      { "web-search": 3 },
    );
    expect(r.effective.map((x) => x.id)).toEqual(["1", "2", "3"]);
    expect(r.refused.map((x) => [x.call.id, x.kind])).toEqual([["4", "budget-exhausted"]]);
  });
});

describe("gateNativeToolCallsForRequiredTools — effective + refused cover every call", () => {
  const c = (id: string, name: string) => ({ id, name });
  const calls = [c("1", "web-search"), c("2", "file-write"), c("3", "file-write"), c("4", "http-get")];
  const cases: ReadonlyArray<[string, Parameters<typeof gateNativeToolCallsForRequiredTools>]> = [
    ["no required tools", [calls, [], new Set()]],
    ["single-step mode", [calls, [], new Set(), undefined, undefined, undefined, undefined, false, { enabled: false }]],
    ["budget", [calls, [], new Set(), undefined, { "web-search": 2 }, { "web-search": 2 }]],
    ["required steering", [calls, ["file-write"], new Set()]],
    ["relevant filter", [[c("1", "web-search"), c("4", "http-get")], ["file-write"], new Set(), ["http-get"]]],
    ["exploratory limit", [[c("1", "web-search"), c("4", "http-get")], ["file-write"], new Set()]],
    ["strict dependency", [[c("1", "web-search")], ["file-write"], new Set(), undefined, undefined, undefined, undefined, true]],
    ["quota conflict", [calls, ["file-write"], new Set(), undefined, {}, { "file-write": 1 }, { "file-write": 2 }]],
  ];
  for (const [name, args] of cases) {
    it(name, () => {
      const r = gateNativeToolCallsForRequiredTools(...args);
      const ids = [...r.effective.map((x) => x.id), ...r.refused.map((x) => x.call.id)].sort();
      expect(ids).toEqual(args[0].map((x) => x.id).sort());
      for (const x of r.refused) expect(r.effective).not.toContain(x.call);
      for (const x of r.refused) expect(x.reason.length).toBeGreaterThan(0);
    });
  }
});
