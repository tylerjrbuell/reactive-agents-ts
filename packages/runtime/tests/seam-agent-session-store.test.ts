import { describe, it, expect } from "bun:test";
import { Layer, ManagedRuntime } from "effect";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryDatabaseLive, SessionStoreLive, defaultMemoryConfig } from "@reactive-agents/memory";
import { makeSessionHistoryStore } from "../src/agent/session-store.js";

describe("makeSessionHistoryStore", () => {
  it("is a graceful no-op / empty history when no SessionStoreService is wired", async () => {
    const rt = ManagedRuntime.make(Layer.empty);
    const store = makeSessionHistoryStore(rt, "agent-1");
    await store.save("s1", [{ role: "user", content: "hi", timestamp: 1 }]);
    expect(await store.load("s1")).toEqual([]);
    await rt.dispose();
  });

  it("round-trips messages through the real SQLite session store, scoped by session id", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-session-store-"));
    const dbLayer = MemoryDatabaseLive({ ...defaultMemoryConfig("agent-1"), dbPath: join(dir, "mem.db") });
    const rt = ManagedRuntime.make(SessionStoreLive.pipe(Layer.provide(dbLayer)));
    try {
      const store = makeSessionHistoryStore(rt, "agent-1");
      const turns = [
        { role: "user" as const, content: "hello", timestamp: 1 },
        { role: "assistant" as const, content: "hi there", timestamp: 2 },
      ];
      await store.save("s1", turns);
      expect(await store.load("s1")).toEqual(turns);
      expect(await store.load("other")).toEqual([]);
    } finally {
      await rt.dispose();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
