// Run: bun test packages/reasoning/tests/kernel/seam-empty-args-batch.test.ts --timeout 20000
//
// A turn whose EVERY tool call has empty arguments although the tools require
// some is one model fault, not N failed calls. Owner trace
// 01M7MXP263N44MPM6B85D2H4JZ: shell-execute {} and todo {} at iter 0, then
// shell-execute {} again at iter 1, each burning a turn on a per-call "missing
// parameter" error. The gate (decide/empty-args-batch.ts, wired in
// gateTurnToolCalls) now refuses the whole batch: every call is answered in the
// thread and ONE corrective line (`errorRecovery`) names each tool, its required
// parameters and an example call.
//
// RED-ON-CUT: make `emptyArgsRefusals` return [] -> (a) and (b) fail (the empty
// calls reach the tool and nothing teaches the shape).
import { describe, it, expect } from "bun:test";
import { Effect, Layer, Ref } from "effect";
import { TestLLMServiceLayer, type TestTurn } from "@reactive-agents/llm-provider";
import { EventBus, EventBusLive, type AgentEvent } from "@reactive-agents/core";
import { reactKernel } from "../../src/kernel/loop/react-kernel.js";
import { runPass } from "../../src/kernel/loop/run-pass.js";
import { mockToolServiceLayer } from "../../src/testing/tool-service-mock.js";
import { emptyArgsGuidance, emptyArgsRefusals, exampleCallOf } from "../../src/kernel/capabilities/decide/empty-args-batch.js";
import type { ToolSchema } from "../../src/kernel/capabilities/attend/tool-formatting.js";
import type { KernelInput, KernelMessage } from "../../src/kernel/state/kernel-state.js";

const SHELL: ToolSchema = {
  name: "shell-execute",
  description: "Run an allowed shell command",
  parameters: [{ name: "command", type: "string", required: true }],
};
const TODO: ToolSchema = {
  name: "todo",
  description: "Track a checklist",
  parameters: [{ name: "action", type: "string", required: true, enum: ["add", "start", "done", "list"] }, { name: "text", type: "string", required: false }],
};
const SEARCH: ToolSchema = {
  name: "web-search",
  description: "Search the web",
  parameters: [{ name: "query", type: "string", required: true }],
};

type GuardEvent = Extract<AgentEvent, { _tag: "GuardFiredEmitted" }>;

async function run(input: KernelInput, turns: TestTurn[]) {
  const executed: string[] = [];
  const tools = mockToolServiceLayer({
    execute: (req) =>
      Effect.sync(() => {
        executed.push(req.toolName);
        return { success: true, result: { ok: true } };
      }),
  });
  const { pass, events } = await Effect.runPromise(
    Effect.gen(function* () {
      const log = yield* Ref.make<AgentEvent[]>([]);
      const bus = yield* EventBus;
      yield* bus.subscribe((ev) => Ref.update(log, (xs) => [...xs, ev]));
      const pass = yield* runPass(reactKernel, input, { maxIterations: 6, strategy: "reactive", kernelType: "react", taskId: "empty-args" });
      return { pass, events: yield* Ref.get(log) };
    }).pipe(Effect.provide(Layer.mergeAll(TestLLMServiceLayer(turns), tools, EventBusLive))),
  );
  const refusals = events.filter((e): e is GuardEvent => e._tag === "GuardFiredEmitted" && e.guard === "tool-gate");
  return { pass, executed, refusals };
}

const resultFor = (messages: readonly KernelMessage[], id: string) =>
  messages.find((m): m is Extract<KernelMessage, { role: "tool_result" }> => m.role === "tool_result" && m.toolCallId === id);

describe("empty-argument batch is one model fault", () => {
  it("(a) trace 01M7MXP263N44MPM6B85D2H4JZ: {} calls are refused, answered, and one corrective line reaches the model", async () => {
    const { pass, executed, refusals } = await run(
      { task: "Check the repo", availableToolSchemas: [SHELL, TODO, SEARCH] },
      [
        { toolCalls: [{ id: "c1", name: "shell-execute", args: {} }, { id: "c2", name: "todo", args: {} }] },
        // Fires only when the corrective guidance reached the model's next request.
        { match: "Your last calls had no arguments", toolCall: { id: "c3", name: "shell-execute", args: { command: "ls" } } },
        { text: "FINAL ANSWER: listed the repo." },
      ],
    );
    // Neither empty call reached a tool; only the corrected call ran.
    expect(executed).toEqual(["shell-execute"]);
    expect(refusals.map((e) => (e.metadata as { kind: string }).kind)).toEqual(["empty-args", "empty-args"]);
    expect(resultFor(pass.messages, "c1")?.content).toContain("shell-execute was not run: it had no arguments (required: command)");
    expect(resultFor(pass.messages, "c2")?.content).toContain("todo was not run: it had no arguments (required: action)");
    expect(pass.output).toContain("listed the repo");
  }, 20000);

  it("(b) a batch with one non-empty call is not this fault: it runs as usual", async () => {
    const { executed, refusals } = await run(
      { task: "Check the repo", availableToolSchemas: [SHELL, SEARCH] },
      [
        { toolCalls: [{ id: "c1", name: "shell-execute", args: {} }, { id: "c2", name: "web-search", args: { query: "x" } }] },
        { text: "FINAL ANSWER: done." },
      ],
    );
    expect(refusals).toEqual([]);
    expect(executed).toEqual(["shell-execute", "web-search"]);
  }, 20000);
});

describe("emptyArgsRefusals / emptyArgsGuidance (unit)", () => {
  const call = (id: string, name: string, args: Record<string, unknown>) => ({ id, name, arguments: args });

  it("refuses only when every call is empty AND its tool requires arguments", () => {
    const schemas = [SHELL, TODO, { name: "pulse", description: "p", parameters: [{ name: "question", type: "string", required: false }] } satisfies ToolSchema];
    expect(emptyArgsRefusals(schemas, [call("a", "shell-execute", {}), call("b", "todo", {})]).map((r) => r.call.id)).toEqual(["a", "b"]);
    expect(emptyArgsRefusals(schemas, [call("a", "shell-execute", {}), call("b", "todo", { action: "list" })])).toEqual([]);
    expect(emptyArgsRefusals(schemas, [call("a", "pulse", {})])).toEqual([]); // nothing required
    expect(emptyArgsRefusals(schemas, [call("a", "ghost", {})])).toEqual([]); // tool not on the surface
    expect(emptyArgsRefusals(schemas, [])).toEqual([]);
  });

  it("a required parameter with a default is not missing", () => {
    const withDefault: ToolSchema = { name: "t", description: "t", parameters: [{ name: "mode", type: "string", required: true, default: "fast" }] };
    expect(emptyArgsRefusals([withDefault], [call("a", "t", {})])).toEqual([]);
  });

  it("the guidance names each distinct tool once, with its required params and an example", () => {
    const refused = emptyArgsRefusals([SHELL, TODO], [call("a", "shell-execute", {}), call("b", "todo", {}), call("c", "shell-execute", {})]);
    expect(emptyArgsGuidance(refused, [SHELL, TODO])).toBe(
      'Your last calls had no arguments, so none ran: call shell-execute with command, e.g. shell-execute({"command":"<command>"}); call todo with action, e.g. todo({"action":"add"}).',
    );
    expect(emptyArgsGuidance([], [SHELL])).toBeUndefined();
    expect(exampleCallOf(SEARCH)).toBe('web-search({"query":"<query>"})');
  });
});
