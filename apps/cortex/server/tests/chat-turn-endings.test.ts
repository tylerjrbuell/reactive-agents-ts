// Run: bun run repo test apps/cortex/server/tests/chat-turn-endings.test.ts
/**
 * Chat behavior bugs from the 2026-11-10 UI audit:
 * - B1: a turn that fails before the model answers (missing model) kept nothing:
 *   the user's message vanished and the UI showed a raw `LLMError:` banner.
 * - B2: leaving mid-reply stored an empty assistant row with no outcome or cause.
 * - B3: a stopped or disconnected chat run stayed `live` in the run list forever.
 */
import { describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { Layer } from "effect";
import { openDatabase } from "../db/schema.js";
import { getChatTurns } from "../db/chat-queries.js";
import { ChatSessionService, turnsToChatMessages } from "../services/chat-session-service.js";
import { CortexIngestService, CortexIngestServiceLive } from "../services/ingest-service.js";
import { CortexEventBridgeLive } from "../services/event-bridge.js";

type FakeEvent = Record<string, unknown>;
type Internal = { sessions: Map<string, { session: { runStream: unknown; chat: unknown } }> };

function setup(withIngest = false) {
  const path = `/tmp/cortex-chat-endings-${crypto.randomUUID()}.db`;
  const db = openDatabase(path);
  const ingestLayer = withIngest
    ? (CortexIngestServiceLive(db).pipe(Layer.provide(CortexEventBridgeLive)) as Layer.Layer<CortexIngestService>)
    : undefined;
  const svc = new ChatSessionService(db, ingestLayer ? { ingestLayer } : undefined);
  return {
    db,
    svc,
    cleanup: async () => {
      await svc.disposeAll();
      db.close();
      for (const sfx of ["", "-wal", "-shm"]) rmSync(path + sfx, { force: true });
    },
  };
}

const MISSING = 'LLMError: Model "no-such-model:1b" not found locally. Run: ollama pull no-such-model:1b';
const CAUSE = 'Model "no-such-model:1b" not found locally. Run: ollama pull no-such-model:1b';

describe("B1: a turn that fails before any answer keeps the message", () => {
  it("tools off: persists the user message and a failed turn with the cause, without the error tag", async () => {
    const { db, svc, cleanup } = setup();
    try {
      const id = await svc.createSession({ agentConfig: { provider: "test", model: "test-model", enableTools: false } });
      await svc.chat(id, "warm");
      (svc as unknown as Internal).sessions.get(id)!.session.chat = async () => {
        throw new Error(MISSING);
      };

      const events: FakeEvent[] = [];
      for await (const e of svc.chatStream(id, "What is 2+2?")) events.push(e as FakeEvent);

      // The client gets the honest failure path (a failed completion), not a raw StreamError.
      expect(events.some((e) => e._tag === "StreamError")).toBe(false);
      const done = events.find((e) => e._tag === "StreamCompleted")!;
      expect(done.success).toBe(false);
      expect(done.output).toBe("");
      expect(done.error).toBe(CAUSE);

      const turns = getChatTurns(db, id);
      expect(turns.some((t) => t.role === "user" && t.content === "What is 2+2?")).toBe(true);
      const last = turns.at(-1)!;
      expect(last.role).toBe("assistant");
      expect(last.trace?.outcome).toEqual({ success: false, ending: "failed", error: CAUSE });
    } finally {
      await cleanup();
    }
  });

  it("a session whose agent cannot be built keeps the message as a failed turn", async () => {
    const { db, svc, cleanup } = setup();
    try {
      const id = await svc.createSession({ agentConfig: { provider: "test", model: "test-model", enableTools: true } });
      (svc as unknown as { getOrBuildSession: () => Promise<never> }).getOrBuildSession = async () => {
        throw new Error("LLMError: provider not configured");
      };
      const events: FakeEvent[] = [];
      for await (const e of svc.chatStream(id, "hello")) events.push(e as FakeEvent);
      expect(events.at(-1)).toMatchObject({ _tag: "StreamCompleted", success: false, error: "provider not configured" });
      const turns = getChatTurns(db, id);
      expect(turns.map((t) => t.role)).toEqual(["user", "assistant"]);
      expect(turns[1]!.trace?.outcome?.ending).toBe("failed");
    } finally {
      await cleanup();
    }
  });
});

describe("B2: a turn interrupted mid-reply is stored as interrupted, with its cause", () => {
  const partialStream = (ac: AbortController | (() => void)) =>
    async function* (): AsyncGenerator<FakeEvent> {
      yield { _tag: "TextDelta", text: "partial answer" };
      if (typeof ac === "function") ac();
      else ac.abort();
      throw new Error("aborted");
    };

  it("the client going away stores interrupted by disconnect, keeping the partial text", async () => {
    const { db, svc, cleanup } = setup();
    try {
      const id = await svc.createSession({ agentConfig: { provider: "test", model: "test-model", enableTools: true } });
      await svc.chat(id, "warm");
      const client = new AbortController();
      (svc as unknown as Internal).sessions.get(id)!.session.runStream = partialStream(client);

      const events: FakeEvent[] = [];
      for await (const e of svc.chatStream(id, "go", client.signal)) events.push(e as FakeEvent);
      expect(events.find((e) => e._tag === "StreamCancelled")?.reason).toBe("disconnect");

      const last = getChatTurns(db, id).at(-1)!;
      expect(last.content).toBe("partial answer");
      expect(last.incomplete).toBe(true);
      expect(last.trace?.outcome?.ending).toBe("interrupted");
      expect(last.trace?.outcome?.interruptedBy).toBe("disconnect");
      expect(last.trace?.outcome?.error).toContain("connection closed");
      // The model is told the reply was cut off, not handed the partial text as an answer.
      const history = turnsToChatMessages(getChatTurns(db, id));
      expect(history.at(-1)?.content).toContain("interrupted");
    } finally {
      await cleanup();
    }
  });

  it("Stop (stopTurn) aborts the run server-side and stores interrupted by the user", async () => {
    const { db, svc, cleanup } = setup();
    try {
      const id = await svc.createSession({ agentConfig: { provider: "test", model: "test-model", enableTools: true } });
      await svc.chat(id, "warm");
      let stopped = false;
      (svc as unknown as Internal).sessions.get(id)!.session.runStream = async function* (
        _msg: string,
        opts: { signal?: AbortSignal },
      ): AsyncGenerator<FakeEvent> {
        yield { _tag: "TextDelta", text: "half" };
        stopped = svc.stopTurn(id);
        if (opts.signal?.aborted) throw new Error("aborted");
        yield { _tag: "TextDelta", text: " never" };
      };

      const events: FakeEvent[] = [];
      for await (const e of svc.chatStream(id, "go", new AbortController().signal)) events.push(e as FakeEvent);
      expect(stopped).toBe(true);
      expect(events.find((e) => e._tag === "StreamCancelled")?.reason).toBe("user");
      const last = getChatTurns(db, id).at(-1)!;
      expect(last.trace?.outcome).toMatchObject({ ending: "interrupted", interruptedBy: "user" });
      // No turn in flight: nothing to stop.
      expect(svc.stopTurn(id)).toBe(false);
    } finally {
      await cleanup();
    }
  });
});

describe("B3: an interrupted chat run reaches a terminal status in the run list", () => {
  it("a disconnect mid-run closes the chat's run as stopped", async () => {
    const { db, svc, cleanup } = setup(true);
    try {
      const id = await svc.createSession({
        agentConfig: { provider: "test", model: "test-model", enableTools: true, testScenario: [{ text: "Done." }] },
      });
      const client = new AbortController();
      for await (const e of svc.chatStream(id, "hello there", client.signal)) {
        // Leave as soon as the run is under way.
        if ((e as FakeEvent)._tag === "PhaseStarted") client.abort();
      }
      await new Promise((r) => setTimeout(r, 200));
      const runs = db.prepare("SELECT run_id, status, completed_at FROM cortex_runs").all() as Array<{
        run_id: string;
        status: string;
        completed_at: number | null;
      }>;
      expect(runs.length).toBeGreaterThan(0);
      expect(runs.filter((r) => r.status === "live")).toEqual([]);
      expect(runs.every((r) => r.status === "stopped" && r.completed_at !== null)).toBe(true);
    } finally {
      await cleanup();
    }
  }, 30_000);

  it("at boot, chat runs left live by a restart close as stopped; a session paused on an approval keeps its run", async () => {
    const { db, svc, cleanup } = setup();
    try {
      const { closeOrphanedChatRuns, insertEvent, updateRunStats, upsertRun } = await import("../db/queries.js");
      const dead = await svc.createSession({ agentConfig: { provider: "test", model: "test-model" } });
      const paused = await svc.createSession({ agentConfig: { provider: "test", model: "test-model" } });
      const root = (runId: string, sessionId: string) => {
        upsertRun(db, "chat-agent", runId);
        insertEvent(db, { v: 1, agentId: "chat-agent", runId, sessionId, event: { _tag: "AgentStarted", taskId: runId } as never }, 0);
      };
      root("root-dead", dead);
      upsertRun(db, "child-agent", "child-dead");
      updateRunStats(db, "child-dead", { rootRunId: "root-dead" });
      root("root-paused", paused);
      db.prepare(
        "INSERT INTO chat_pending_approvals (run_id, session_id, user_message, gate_id, tool_name, args_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run("durable-1", paused, "do it", "g", "file-write", "{}", 1);
      // A run from an external agent (no chat session) may still be alive: left alone.
      upsertRun(db, "external", "ext-run");

      expect(closeOrphanedChatRuns(db, 42)).toBe(2);
      const status = (runId: string) =>
        (db.prepare("SELECT status FROM cortex_runs WHERE run_id = ?").get(runId) as { status: string }).status;
      expect(status("root-dead")).toBe("stopped");
      expect(status("child-dead")).toBe("stopped");
      expect(status("root-paused")).toBe("live");
      expect(status("ext-run")).toBe("live");
      // Ended at its last event, not at the boot that closed it.
      const ended = (runId: string) =>
        (db.prepare("SELECT completed_at FROM cortex_runs WHERE run_id = ?").get(runId) as { completed_at: number }).completed_at;
      const lastTs = (db.prepare("SELECT MAX(ts) AS ts FROM cortex_events WHERE run_id = 'root-dead'").get() as { ts: number }).ts;
      expect(ended("root-dead")).toBe(lastTs);
      expect(ended("child-dead")).toBe(42);
    } finally {
      await cleanup();
    }
  });

  it("a failed run that reports after a stop stays stopped; a success still wins", async () => {
    const { db, cleanup } = setup();
    try {
      const { upsertRun, updateRunStats } = await import("../db/queries.js");
      upsertRun(db, "agent-a", "run-a");
      updateRunStats(db, "run-a", { status: "stopped", completedAt: 1 });
      updateRunStats(db, "run-a", { status: "failed" });
      upsertRun(db, "agent-a", "run-b");
      updateRunStats(db, "run-b", { status: "stopped", completedAt: 1 });
      updateRunStats(db, "run-b", { status: "completed" });
      const status = (runId: string) =>
        (db.prepare("SELECT status FROM cortex_runs WHERE run_id = ?").get(runId) as { status: string }).status;
      expect(status("run-a")).toBe("stopped");
      expect(status("run-b")).toBe("completed");
    } finally {
      await cleanup();
    }
  });
});
