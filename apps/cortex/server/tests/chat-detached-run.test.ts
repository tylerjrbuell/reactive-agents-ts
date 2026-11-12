// Run: bun run repo test apps/cortex/server/tests/chat-detached-run.test.ts
/**
 * Goal segments, schedule fires and loop ticks stream live: they run as detached turns in the
 * same buffer the chat panel attaches to, instead of the non-streaming `chat()`.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { rmSync } from "node:fs";
import { openDatabase } from "../db/schema.js";
import { getChatTurns } from "../db/chat-queries.js";
import { chatRouter } from "../api/chat.js";
import { ChatGoalService } from "../services/chat-goal-service.js";
import { DetachedTurns } from "../services/chat-detached-turn.js";
import { makeDetachedRunner } from "../services/chat-detached-run.js";
import { ChatSessionBusyError, ChatSessionService } from "../services/chat-session-service.js";

const path = `/tmp/cortex-detached-run-${crypto.randomUUID()}.db`;
let db: ReturnType<typeof openDatabase>;
let svc: ChatSessionService;
let turns: DetachedTurns;

beforeEach(() => {
  db = openDatabase(path);
  svc = new ChatSessionService(db);
  turns = new DetachedTurns();
});
afterEach(() => {
  db.close();
  rmSync(path, { force: true });
});

const newSession = () =>
  svc.createSession({ name: "g", agentConfig: { provider: "test", model: "test-model" } });

const get = (app: { handle: (r: Request) => Promise<Response> }, url: string) => app.handle(new Request(`http://localhost${url}`));

describe("makeDetachedRunner", () => {
  it("the turn is attachable while it runs, then the stored turn and result land", async () => {
    const id = await newSession();
    const app = new Elysia().use(chatRouter(svc, undefined, undefined, undefined, undefined, turns));
    const run = makeDetachedRunner(svc, turns);

    const pending = run(id, "work on it");
    // Live while in flight: the reloaded page asks /active, then attaches.
    const active = (await (await get(app, `/api/chat/sessions/${id}/chat/active`)).json()) as { active: boolean; message?: string };
    expect(active).toMatchObject({ active: true, message: "work on it" });

    const result = await pending;
    expect(result.reply.length).toBeGreaterThan(0);
    expect(turns.running(id)).toBeUndefined();
    // The buffered events replay to a late attacher (tokens + completion).
    const sse = await (await get(app, `/api/chat/sessions/${id}/chat/stream/active`)).text();
    expect(sse).toContain('"_tag":"TextDelta"');
    expect(sse).toContain('"_tag":"StreamCompleted"');
    // And the turn is stored exactly once.
    expect(getChatTurns(db, id).map((t) => t.role)).toEqual(["user", "assistant"]);
  });

  it("keeps the busy guard: a second turn rejects with ChatSessionBusyError while one runs", async () => {
    const id = await newSession();
    const run = makeDetachedRunner(svc, turns);
    const first = run(id, "one");
    await expect(run(id, "two")).rejects.toBeInstanceOf(ChatSessionBusyError);
    await first;
  });
});

describe("goal segments stream live", () => {
  it("a goal segment populates the detached buffer; a user stream is still 409 during the goal", async () => {
    const id = await newSession();
    const goals = new ChatGoalService(db, makeDetachedRunner(svc, turns), { checker: async () => null });
    const app = new Elysia().use(chatRouter(svc, undefined, goals, undefined, undefined, turns));
    const r = goals.propose(id, { objective: "say hi", criteria: [{ text: "any", check: { kind: "regex", pattern: ".*" } }] });
    if (!r.ok) throw new Error(r.message);
    goals.accept(id);

    const blocked = await app.handle(
      new Request(`http://localhost/api/chat/sessions/${id}/chat/stream`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "hey" }),
      }),
    );
    expect(blocked.status).toBe(409);

    await goals.settled(id);
    const sse = await (await get(app, `/api/chat/sessions/${id}/chat/stream/active`)).text();
    expect(sse).toContain('"_tag":"StreamCompleted"');
    expect(sse).toContain('"_tag":"TextDelta"');
  });
});
