// Run: bun run repo test apps/cortex/server/tests/chat-aborted-turn.test.ts
import { describe, expect, it } from "bun:test";
import { rmDbFiles, tmpDbPath } from "./helpers/tmp-db.js";
import { openDatabase } from "../db/schema.js";
import { getChatTurns, getChatSessionTotals } from "../db/chat-queries.js";
import { ChatSessionService, turnsToChatMessages } from "../services/chat-session-service.js";

type FakeEvent = Record<string, unknown>;
type Internal = { sessions: Map<string, { session: { runStream: unknown; chat: unknown } }> };

function setup() {
  const path = tmpDbPath("chat-abort");
  const db = openDatabase(path);
  const svc = new ChatSessionService(db);
  return { db, svc, cleanup: () => { db.close(); rmDbFiles(path); } };
}

const usageEvent = (): FakeEvent => ({
  _tag: "TokenUsage",
  callId: "call-1",
  tokensTotal: 120,
  tokensIn: 100,
  tokensOut: 20,
  billedTokens: 90,
  estimated: false,
  model: "test-model",
  provider: "test",
  durationMs: 5,
  costUsd: 0.002,
});

describe("aborted chat turn persistence", () => {
  it("persists the partial reply and the spend it already incurred, marked incomplete", async () => {
    const { db, svc, cleanup } = setup();
    try {
      const id = await svc.createSession({ agentConfig: { provider: "test", model: "test-model", enableTools: true } });
      await svc.chat(id, "warm");
      const before = getChatSessionTotals(db, id).tokens;

      const ac = new AbortController();
      (svc as unknown as Internal).sessions.get(id)!.session.runStream = async function* (): AsyncGenerator<FakeEvent> {
        yield { _tag: "TextDelta", text: "partial answer" };
        yield usageEvent();
        ac.abort();
        throw new Error("aborted by user");
      };

      const events: FakeEvent[] = [];
      for await (const e of svc.chatStream(id, "go", ac.signal)) events.push(e as FakeEvent);

      expect(events.some((e) => e._tag === "StreamCancelled")).toBe(true);

      const turns = getChatTurns(db, id);
      const last = turns.filter((t) => t.role === "assistant").at(-1)!;
      expect(last.content).toBe("partial answer");
      expect(last.tokensUsed).toBe(120);
      expect(last.tokensIn).toBe(100);
      expect(last.tokensOut).toBe(20);
      expect(last.incomplete).toBe(true);

      // The spend is visible in the session totals instead of vanishing.
      expect(getChatSessionTotals(db, id).tokens).toBe(before + 120);

      await svc.disposeAll();
    } finally {
      cleanup();
    }
  });

  it("keeps the user message and the spend when the abort arrives before any text", async () => {
    const { db, svc, cleanup } = setup();
    try {
      const id = await svc.createSession({ agentConfig: { provider: "test", model: "test-model", enableTools: true } });
      await svc.chat(id, "warm");
      const before = getChatSessionTotals(db, id).tokens;

      const ac = new AbortController();
      (svc as unknown as Internal).sessions.get(id)!.session.runStream = async function* (): AsyncGenerator<FakeEvent> {
        yield usageEvent();
        ac.abort();
        throw new Error("aborted by user");
      };

      for await (const _ of svc.chatStream(id, "go", ac.signal)) void _;

      const turns = getChatTurns(db, id);
      expect(turns.some((t) => t.role === "user" && t.content === "go")).toBe(true);
      const last = turns.filter((t) => t.role === "assistant").at(-1)!;
      expect(last.content).toBe("");
      expect(last.incomplete).toBe(true);
      expect(last.tokensUsed).toBe(120);
      // An empty incomplete reply must never become model-visible history.
      expect(turnsToChatMessages(turns).some((m) => m.role === "assistant" && m.content === "")).toBe(false);
      expect(getChatSessionTotals(db, id).tokens).toBe(before + 120);

      await svc.disposeAll();
    } finally {
      cleanup();
    }
  });
});
