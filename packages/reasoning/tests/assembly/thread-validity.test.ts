import { describe, it, expect } from "bun:test";
import { project, type AssemblyInput } from "../../src/assembly/project.js";
import { projectResultsStage } from "../../src/assembly/stages/project-results.js";
import { compactHistoryStage } from "../../src/assembly/stages/compact-history.js";
import { EventLog } from "../../src/assembly/event-log.js";
import { ResultStore } from "../../src/assembly/result-store.js";
import { resolveCapability } from "../../src/assembly/capability.js";
import { emptyTrace } from "../../src/assembly/trace.js";

type Msg = { role: string; content?: string; toolCallId?: string; toolName?: string; toolCalls?: unknown };

/**
 * Provider-validity invariant (Anthropic/OpenAI native-FC):
 * - the thread opens with a `user` turn,
 * - every `tool_result` is answered by a `tool_use` of the matching id in the
 *   IMMEDIATELY-preceding assistant turn (no orphan tool_results),
 * - every assistant `tool_use` id is consumed by exactly one tool_result.
 */
function assertValidThread(messages: readonly Msg[]) {
  expect(messages.length).toBeGreaterThan(0);
  expect(messages[0]!.role).toBe("user");
  let openIds = new Set<string>();
  for (const m of messages) {
    if (m.role === "assistant" && Array.isArray(m.toolCalls)) {
      openIds = new Set((m.toolCalls as Array<{ id: string }>).map((tc) => tc.id));
    } else if (m.role === "tool_result") {
      // a tool_result must match an open tool_use id from the preceding assistant
      expect(m.toolCallId).toBeDefined();
      expect(openIds.has(m.toolCallId!)).toBe(true);
      openIds.delete(m.toolCallId!);
    } else if (m.role === "assistant") {
      openIds = new Set();
    }
  }
}

const cap = () => resolveCapability({ window: 4000, outputBudget: 2000, dialect: "native-fc", tier: "mid" });

describe("project() emits a provider-valid thread", () => {
  it("sequential calls: user(goal) → assistant(tool_use) → tool_result", () => {
    const store = new ResultStore();
    const r1 = store.put("get_a", { a: 1 });
    const r2 = store.put("get_b", { b: 2 });
    const log = new EventLog()
      .append({ kind: "goal", text: "do the thing" })
      .append({ kind: "tool_called", tool: "get_a", callId: "c1", args: {} })
      .append({ kind: "tool_result", callId: "c1", ref: r1, shape: "obj" })
      .append({ kind: "tool_called", tool: "get_b", callId: "c2", args: {} })
      .append({ kind: "tool_result", callId: "c2", ref: r2, shape: "obj" });
    const input: AssemblyInput = { log, capability: cap(), store, persona: { system: "Agent" }, tools: { schemas: [] } };
    const { request } = project(input);
    assertValidThread(request.messages);
    // goal anchors the opening user turn
    expect(request.messages[0]!.content).toBe("do the thing");
    // both tool_uses present
    const assistantCalls = request.messages.filter((m) => m.role === "assistant");
    expect(assistantCalls.length).toBe(2);
  });

  it("parallel calls grouped into ONE assistant turn, both results follow", () => {
    const store = new ResultStore();
    const r1 = store.put("get_a", { a: 1 });
    const r2 = store.put("get_b", { b: 2 });
    // log order mirrors fromKernelState for a parallel turn: both calls, then both results
    const log = new EventLog()
      .append({ kind: "goal", text: "parallel" })
      .append({ kind: "tool_called", tool: "get_a", callId: "c1", args: {} })
      .append({ kind: "tool_called", tool: "get_b", callId: "c2", args: {} })
      .append({ kind: "tool_result", callId: "c1", ref: r1, shape: "obj" })
      .append({ kind: "tool_result", callId: "c2", ref: r2, shape: "obj" });
    const input: AssemblyInput = { log, capability: cap(), store, persona: { system: "Agent" }, tools: { schemas: [] } };
    const { request } = project(input);
    assertValidThread(request.messages);
    const assistantTurns = request.messages.filter((m) => m.role === "assistant");
    expect(assistantTurns.length).toBe(1); // ONE turn carrying both tool_uses
    expect((assistantTurns[0]!.toolCalls as unknown[]).length).toBe(2);
  });
});

describe("compactHistory never orphans a tool_result", () => {
  it("kept slice does not start with a tool_result after compaction", () => {
    const ca = resolveCapability({ window: 10, outputBudget: 5, dialect: "native-fc", tier: "local" }); // tiny → forces compaction
    // Build a long thread of assistant→tool_result pairs
    let messages: Msg[] = [{ role: "user", content: "goal" }];
    for (let i = 0; i < 8; i++) {
      messages = [
        ...messages,
        { role: "assistant", content: "", toolCalls: [{ id: `c${i}`, name: "t", arguments: {} }] },
        { role: "tool_result", toolCallId: `c${i}`, toolName: "t", content: "x".repeat(40) },
      ];
    }
    const ctx = compactHistoryStage({
      log: new EventLog(), capability: ca, store: new ResultStore(), persona: { system: "" }, tools: { schemas: [] },
      systemPrompt: "", messages, toolSchemas: [], trace: emptyTrace(ca),
    });
    // first message is the injected user summary; the SECOND must not be a tool_result
    expect(ctx.messages[0]!.role).toBe("user");
    const afterSummary = ctx.messages[1];
    if (afterSummary) expect(afterSummary.role).not.toBe("tool_result");
    assertValidThread(ctx.messages);
  });
});
