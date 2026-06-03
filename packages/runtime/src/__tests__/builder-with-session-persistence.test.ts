// Run: bun test packages/runtime/src/__tests__/builder-with-session-persistence.test.ts --timeout 30000
//
// Regression test for session persistence fix — covers three bugs:
//
//  Bug 1: SessionStoreLive gated on `options.sessionPersist` which had no builder
//          setter and defaulted false — service was never wired when using
//          .withMemory(). Fixed: gate on `options.enableMemory` (mirrors SkillStoreLive).
//
//  Bug 2: AgentSession.chat() never called onSave — only end() did. Sessions never
//          persisted without an explicit end() call. Fixed: auto-save after each chat().
//
//  Bug 3: session() never loaded prior history — initialHistory always undefined.
//          Fixed: lazy historyLoader calls findById(sessionId) before first message.
//
// Coverage:
//  (a) SessionStoreService is wired when enableMemory:true
//  (b) SessionStoreService is absent when enableMemory:false
//  (c) cross-session restore — chat in session A, restore by same id in session B sharing dbPath

import { describe, it, expect, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { Effect, Layer } from "effect";
import { createRuntime } from "../runtime.js";
import { SessionStoreService } from "@reactive-agents/memory";
import { ReactiveAgents } from "../builder.js";

describe("createRuntime → SessionStoreLive wiring", () => {
  let tmpDir: string | undefined;

  afterEach(() => {
    if (tmpDir) {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      tmpDir = undefined;
    }
  });

  const probeSessionStore = async (
    layer: Layer.Layer<any, any, any>,
  ): Promise<boolean> => {
    return Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const opt = yield* Effect.serviceOption(SessionStoreService);
          return opt._tag === "Some";
        }).pipe(Effect.provide(layer as Layer.Layer<any>)),
      ),
    );
  };

  it("(a) SessionStoreService wired when enableMemory:true", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ra-sess-wire-"));
    const dbPath = path.join(tmpDir, "sessions.db");

    const layer = createRuntime({
      agentId: "sess-wire-agent",
      provider: "test",
      enableMemory: true,
      memoryOptions: { dbPath },
    });

    expect(await probeSessionStore(layer)).toBe(true);
  });

  it("(b) SessionStoreService absent when enableMemory:false", async () => {
    const layer = createRuntime({
      agentId: "sess-nomem-agent",
      provider: "test",
      enableMemory: false,
    });

    expect(await probeSessionStore(layer)).toBe(false);
  });

  it("(c) cross-session restore — history saved in session A is recalled in session B", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ra-sess-xsession-"));
    const dbPath = path.join(tmpDir, "sessions.db");
    const sessionId = "test-restore-session";

    // Build agent A — send messages, history auto-saved per chat()
    const agentA = await ReactiveAgents.create()
      .withProvider("test")
      .withMemory({ dbPath })
      .build();

    const sessionA = agentA.session({ persist: true, id: sessionId });
    await sessionA.chat("Hello my name is John Doe");
    await sessionA.chat("What is my name?");

    // Verify A's in-memory history has 4 messages (2 user + 2 assistant)
    expect(sessionA.history().length).toBe(4);

    // Build agent B with same dbPath — simulates process restart
    const agentB = await ReactiveAgents.create()
      .withProvider("test")
      .withMemory({ dbPath })
      .build();

    const sessionB = agentB.session({ persist: true, id: sessionId });

    // On first chat(), historyLoader fires and restores prior history
    await sessionB.chat("What is my name?");

    // B's history should include prior messages from A plus the new exchange
    const historyB = sessionB.history();
    expect(historyB.length).toBeGreaterThanOrEqual(5); // ≥4 restored + 2 new − 1 (user message already counted)
    const allContent = historyB.map((m) => m.content).join(" ");
    expect(allContent).toContain("John Doe");
  }, 30000);
});
