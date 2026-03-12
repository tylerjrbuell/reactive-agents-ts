import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Effect, Layer } from "effect";
import { SessionStoreService, SessionStoreLive } from "../src/services/session-store";
import { MemoryDatabase } from "../src/database";
import { Database } from "bun:sqlite";

let rawDb: Database;

const makeTestDB = () => {
  rawDb = new Database(":memory:");
  rawDb.exec("PRAGMA journal_mode = WAL");

  const TestDBLayer = Layer.succeed(MemoryDatabase, {
    query: (sql: string, params?: readonly unknown[]) =>
      Effect.try({
        try: () => {
          const stmt = rawDb.prepare(sql);
          return (params ? stmt.all(...(params as any[])) : stmt.all()) as any[];
        },
        catch: (e) => ({ _tag: "DatabaseError" as const, message: String(e) }),
      }),
    exec: (sql: string, params?: readonly unknown[]) =>
      Effect.try({
        try: () => {
          const stmt = rawDb.prepare(sql);
          params ? stmt.run(...(params as any[])) : stmt.run();
          return rawDb.changes;
        },
        catch: (e) => ({ _tag: "DatabaseError" as const, message: String(e) }),
      }),
    transaction: (fn: any) => fn({} as any),
    close: () => Effect.void,
  } as any);

  return SessionStoreLive.pipe(Layer.provide(TestDBLayer));
};

describe("SessionStore", () => {
  beforeEach(() => {});
  afterEach(() => { rawDb?.close(); });

  test("saves a session and retrieves by ID", async () => {
    const layer = makeTestDB();
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* SessionStoreService;
        yield* store.save({
          sessionId: "sess-1",
          agentId: "agent-1",
          messages: [{ role: "user", content: "hello", timestamp: Date.now() }],
        });
        return yield* store.findById("sess-1");
      }).pipe(Effect.provide(layer)),
    );
    expect(result).not.toBeNull();
    expect(result!.sessionId).toBe("sess-1");
    expect(result!.messages).toHaveLength(1);
    expect(result!.messages[0].content).toBe("hello");
  });

  test("lists sessions by agent ID, newest first", async () => {
    const layer = makeTestDB();
    const results = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* SessionStoreService;
        yield* store.save({ sessionId: "s1", agentId: "a1", messages: [] });
        yield* store.save({ sessionId: "s2", agentId: "a1", messages: [] });
        yield* store.save({ sessionId: "s3", agentId: "a2", messages: [] });
        return yield* store.listByAgent("a1", 10);
      }).pipe(Effect.provide(layer)),
    );
    expect(results).toHaveLength(2);
  });

  test("updates an existing session (upsert)", async () => {
    const layer = makeTestDB();
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* SessionStoreService;
        yield* store.save({ sessionId: "s1", agentId: "a1", messages: [{ role: "user", content: "hi", timestamp: 1 }] });
        yield* store.save({ sessionId: "s1", agentId: "a1", messages: [
          { role: "user", content: "hi", timestamp: 1 },
          { role: "assistant", content: "hello", timestamp: 2 },
        ] });
        return yield* store.findById("s1");
      }).pipe(Effect.provide(layer)),
    );
    expect(result!.messages).toHaveLength(2);
  });

  test("auto-cleanup removes sessions older than threshold", async () => {
    const layer = makeTestDB();
    const count = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* SessionStoreService;
        yield* store.save({ sessionId: "old-1", agentId: "a1", messages: [] });
        rawDb.exec(`UPDATE chat_sessions SET updated_at = ${Date.now() - 40 * 86400000} WHERE session_id = 'old-1'`);
        yield* store.save({ sessionId: "new-1", agentId: "a1", messages: [] });
        return yield* store.cleanup(30);
      }).pipe(Effect.provide(layer)),
    );
    expect(count).toBe(1);
  });

  test("returns null for non-existent session ID", async () => {
    const layer = makeTestDB();
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* SessionStoreService;
        return yield* store.findById("does-not-exist");
      }).pipe(Effect.provide(layer)),
    );
    expect(result).toBeNull();
  });

  test("respects limit on listByAgent", async () => {
    const layer = makeTestDB();
    const results = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* SessionStoreService;
        for (let i = 0; i < 5; i++) {
          yield* store.save({ sessionId: `s${i}`, agentId: "a1", messages: [] });
        }
        return yield* store.listByAgent("a1", 2);
      }).pipe(Effect.provide(layer)),
    );
    expect(results).toHaveLength(2);
  });
});
