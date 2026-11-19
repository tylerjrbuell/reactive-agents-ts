import { describe, expect, it } from "bun:test";
import { rmDbFiles, tmpDbPath } from "./helpers/tmp-db.js";
import { openDatabase } from "../db/schema.js";
import { ChatSessionService } from "../services/chat-session-service.js";
import { ChatEnvironment, countTodoEdits } from "../services/chat-environment.js";

function setup() {
  const path = tmpDbPath("chat-env");
  const db = openDatabase(path);
  const svc = new ChatSessionService(db);
  return { svc, cleanup: () => { db.close(); rmDbFiles(path); } };
}
const drain = async (svc: ChatSessionService, id: string, msg: string): Promise<void> => {
  for await (const e of svc.chatStream(id, msg)) void e;
};
type Internal = { env: ChatEnvironment };
type Ev = { _tag: string; changes?: ReadonlyArray<{ kind: string }> };

/** Count EnvironmentChanged events the session's runtime bus publishes, via the engine's default publisher. */
function captureEnvEvents(svc: ChatSessionService): Ev[] {
  const out: Ev[] = [];
  const orig = (svc as unknown as { buildSession: (...a: unknown[]) => Promise<{ agent: unknown }> }).buildSession.bind(svc);
  (svc as unknown as { buildSession: unknown }).buildSession = async (...a: unknown[]) => {
    const built = await orig(...a);
    const agent = built.agent as { subscribe?: (h: (e: Ev) => void) => unknown };
    await agent.subscribe?.((e) => { if (e._tag === "EnvironmentChanged") out.push(e); });
    return built;
  };
  return out;
}

describe("chat environment updates", () => {
  it("countTodoEdits counts id adds/removes only", () => {
    const a = [{ id: "1", title: "a", status: "pending" as const }, { id: "2", title: "b", status: "pending" as const }];
    const b = [{ id: "1", title: "a2", status: "completed" as const }, { id: "3", title: "c", status: "pending" as const }];
    expect(countTodoEdits(a, b)).toEqual({ added: 1, removed: 1 });
    expect(countTodoEdits(a, a)).toEqual({ added: 0, removed: 0 });
  });

  it("user to-do edits accumulate across setTodo calls; deleteSession clears them", async () => {
    const { svc, cleanup } = setup();
    try {
      const id = await svc.createSession({ agentConfig: { provider: "test", model: "m", enableTools: true } });
      await svc.setTodo(id, [{ id: "1", title: "a", status: "pending" }]);
      await svc.setTodo(id, [{ id: "1", title: "a", status: "completed" }, { id: "2", title: "b", status: "pending" }]);
      await svc.setTodo(id, []);
      expect((svc as unknown as Internal).env.userEdits(id)).toEqual({ added: 2, removed: 2 });
      await svc.deleteSession(id);
      expect((svc as unknown as Internal).env.userEdits(id)).toEqual({ added: 0, removed: 0 });
    } finally { cleanup(); }
  });

  it("a config change between turns yields exactly one EnvironmentChanged; an unchanged turn yields none", async () => {
    const { svc, cleanup } = setup();
    try {
      const events = captureEnvEvents(svc);
      const id = await svc.createSession({ agentConfig: { provider: "test", model: "m1", enableTools: true } });
      await drain(svc, id, "one");
      await drain(svc, id, "two"); // unchanged
      expect(events.length).toBe(0);
      await svc.updateSessionConfig(id, { model: "m2", documents: [{ source: "https://example.com/a.md", content: "x" }] });
      await drain(svc, id, "three");
      expect(events.length).toBe(1);
      expect(events[0]!.changes!.map((c) => c.kind)).toEqual(expect.arrayContaining(["model", "docs"]));
      await drain(svc, id, "four"); // unchanged again
      expect(events.length).toBe(1);
      await svc.disposeAll();
    } finally { cleanup(); }
  });

  it("user to-do edit across a rebuild is reported; environmentUpdates:false is silent", async () => {
    const { svc, cleanup } = setup();
    try {
      const events = captureEnvEvents(svc);
      const id = await svc.createSession({ agentConfig: { provider: "test", model: "m", enableTools: true } });
      const off = await svc.createSession({ agentConfig: { provider: "test", model: "m", enableTools: true, environmentUpdates: false } });
      await drain(svc, id, "a"); await drain(svc, off, "a");
      await svc.setTodo(id, [{ id: "1", title: "x", status: "pending" }]);
      await svc.updateSessionConfig(off, { model: "other" });
      await drain(svc, id, "b"); await drain(svc, off, "b");
      expect(events.length).toBe(1);
      expect(events[0]!.changes!.map((c) => c.kind)).toEqual(["todo-user-edit"]);
      await svc.disposeAll();
    } finally { cleanup(); }
  });
});

describe("chat environment: source and baseline (G10)", () => {
  const row = (id: string) => ({ id, title: id, status: "pending" as const });

  it("(a) an agent-originated to-do write is not a user edit and yields no notice", async () => {
    const { svc, cleanup } = setup();
    try {
      const events = captureEnvEvents(svc);
      const id = await svc.createSession({ agentConfig: { provider: "test", model: "m", enableTools: true } });
      await drain(svc, id, "a");
      await svc.setTodo(id, [row("1"), row("2")], "agent");
      await svc.setTodo(id, [], "agent");
      expect((svc as unknown as Internal).env.userEdits(id)).toEqual({ added: 0, removed: 0 });
      await drain(svc, id, "b");
      expect(events.length).toBe(0);
      await svc.disposeAll();
    } finally { cleanup(); }
  });

  it("(b) a user dock edit counts once and yields exactly one notice on the next turn", async () => {
    const { svc, cleanup } = setup();
    try {
      const events = captureEnvEvents(svc);
      const id = await svc.createSession({ agentConfig: { provider: "test", model: "m", enableTools: true } });
      await drain(svc, id, "a");
      await svc.setTodo(id, [row("1")]);
      expect((svc as unknown as Internal).env.userEdits(id)).toEqual({ added: 1, removed: 0 });
      await drain(svc, id, "b");
      expect(events.length).toBe(1);
      expect(events[0]!.changes!.map((c) => c.kind)).toEqual(["todo-user-edit"]);
      await drain(svc, id, "c"); // consumed: no repeat
      expect(events.length).toBe(1);
      await svc.disposeAll();
    } finally { cleanup(); }
  });

  it("(c) reading the environment does not advance the baseline; only a settled turn does", () => {
    const env = new ChatEnvironment();
    let model = "m1";
    env.attach("s", () => ({ model }));
    env.settle("s");
    expect(env.baselineOf("s")).toEqual({ model: "m1" });
    model = "m2";
    // The engine can read the snapshot any number of times; the pending diff stays.
    expect(env.baselineOf("s")).toEqual({ model: "m1" });
    env.settle("s");
    expect(env.baselineOf("s")).toEqual({ model: "m2" });
    env.forget("s");
    expect(env.baselineOf("s")).toBeUndefined();
  });

  it("(c) a rebuild before the next turn keeps the pending diff for that turn", async () => {
    const { svc, cleanup } = setup();
    try {
      const events = captureEnvEvents(svc);
      const id = await svc.createSession({ agentConfig: { provider: "test", model: "m", enableTools: true } });
      await drain(svc, id, "a");
      await svc.setTodo(id, [row("1")]); // evicts the engine
      await svc.updateSessionConfig(id, { model: "m2" }); // rebuilds again, still no turn
      await drain(svc, id, "b");
      expect(events.length).toBe(1);
      expect(events[0]!.changes!.map((c) => c.kind)).toEqual(expect.arrayContaining(["todo-user-edit", "model"]));
      await svc.disposeAll();
    } finally { cleanup(); }
  });

  it("(d) the first turn of a session emits no notice, even after an earlier user edit", async () => {
    const { svc, cleanup } = setup();
    try {
      const events = captureEnvEvents(svc);
      const id = await svc.createSession({ agentConfig: { provider: "test", model: "m", enableTools: true } });
      await svc.setTodo(id, [row("1")]);
      await drain(svc, id, "first");
      expect(events.length).toBe(0);
      await svc.disposeAll();
    } finally { cleanup(); }
  });
});
