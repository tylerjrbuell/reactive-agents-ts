import { describe, expect, it, afterEach, spyOn } from "bun:test";
import { Database } from "bun:sqlite";
import { ReactiveAgent } from "@reactive-agents/runtime";
import { applySchema } from "../db/schema.js";
import { createChatSession } from "../db/chat-queries.js";
import { ChatSessionService } from "../services/chat-session-service.js";
import { makeAgentRubricChecker } from "../services/chat-goal-service.js";

type RunArgs = Parameters<ReactiveAgent["run"]>;
type SessionArgs = Parameters<ReactiveAgent["session"]>;

const fakeResult = { output: "achieved", metadata: {} } as unknown as Awaited<ReturnType<ReactiveAgent["run"]>>;

const spyRun = (): { calls: RunArgs[] } => {
  const calls: RunArgs[] = [];
  spyOn(ReactiveAgent.prototype, "run").mockImplementation(async (...args: RunArgs) => {
    calls.push(args);
    return fakeResult;
  });
  return { calls };
};

describe("Cortex origin wiring", () => {
  const spies: Array<{ mockRestore: () => void }> = [];
  afterEach(() => {
    for (const s of spies.splice(0)) s.mockRestore();
  });

  it("title generation runs as cortex-utility", async () => {
    const db = new Database(":memory:");
    applySchema(db);
    const calls: RunArgs[] = [];
    spies.push(
      spyOn(ReactiveAgent.prototype, "run").mockImplementation(async (...a: RunArgs) => {
        calls.push(a);
        return fakeResult;
      }),
    );
    const svc = new ChatSessionService(db);
    const t = svc as unknown as {
      titleWithAgent: (u: string, r: string, c: Record<string, unknown>) => Promise<string>;
    };
    await t.titleWithAgent("hi", "hello", { provider: "test" });
    expect(calls.length).toBe(1);
    expect(calls[0]?.[1]?.origin).toBe("cortex-utility");
  });

  it("compaction summary runs as cortex-utility", async () => {
    const db = new Database(":memory:");
    applySchema(db);
    const calls: RunArgs[] = [];
    spies.push(
      spyOn(ReactiveAgent.prototype, "run").mockImplementation(async (...a: RunArgs) => {
        calls.push(a);
        return fakeResult;
      }),
    );
    const svc = new ChatSessionService(db);
    const t = svc as unknown as {
      summarizeWithAgent: (turns: ReadonlyArray<{ role: string; content: string }>, c: Record<string, unknown>) => Promise<string>;
    };
    await t.summarizeWithAgent([{ role: "user", content: "x" }], { provider: "test" });
    expect(calls[0]?.[1]?.origin).toBe("cortex-utility");
  });

  it("goal rubric checker runs as cortex-utility", async () => {
    const db = new Database(":memory:");
    applySchema(db);
    const sid = createChatSession(db, { agentConfig: { provider: "test" } });
    const calls: RunArgs[] = [];
    spies.push(
      spyOn(ReactiveAgent.prototype, "run").mockImplementation(async (...a: RunArgs) => {
        calls.push(a);
        return fakeResult;
      }),
    );
    const check = makeAgentRubricChecker(db);
    const state = {
      objective: "o",
      criteria: [{ id: "c1", text: "t", check: { kind: "rubric" } }],
    } as unknown as Parameters<typeof check>[1];
    await check(sid, state, { output: "work" } as unknown as Parameters<typeof check>[2]);
    expect(calls[0]?.[1]?.origin).toBe("cortex-utility");
  });

  it("chat sessions are built with session default origin cortex-chat", async () => {
    const db = new Database(":memory:");
    applySchema(db);
    const sessionCalls: SessionArgs[] = [];
    const orig = ReactiveAgent.prototype.session;
    spies.push(
      spyOn(ReactiveAgent.prototype, "session").mockImplementation(function (this: ReactiveAgent, ...a: SessionArgs) {
        sessionCalls.push(a);
        return orig.apply(this, a);
      }),
    );
    const svc = new ChatSessionService(db);
    const id = await svc.createSession({ name: "o", agentConfig: { provider: "test", model: "test-model" } });
    const b = svc as unknown as {
      buildSession: (s: string, c: Record<string, unknown>) => Promise<unknown>;
    };
    await b.buildSession(id, { provider: "test", model: "test-model" });
    expect(sessionCalls[0]?.[0]?.origin).toBe("cortex-chat");
  });
});
