// Run: bun run repo test apps/cortex/server/tests/chat-stop-settle.test.ts
/**
 * Stop then immediately edit (rewind) / send: the aborted turn releases the session's in-flight
 * guard a moment AFTER the stop request returns, so the edit used to fail with
 * "Chat session <id> is busy: a turn is already in flight". Stop now answers once the turn let go,
 * and a history change or send right after a Stop waits (bounded) for the release.
 */
import { describe, expect, it } from "bun:test";
import { rmDbFiles, tmpDbPath } from "./helpers/tmp-db.js";
import { openDatabase } from "../db/schema.js";
import { getChatTurns } from "../db/chat-queries.js";
import { ChatSessionService, ChatSessionBusyError } from "../services/chat-session-service.js";
import { ChatTurnStops } from "../services/chat-turn-stop.js";
import { interruptChatTurnSettled } from "../services/chat-run-control.js";

type FakeEvent = Record<string, unknown>;
type Internal = { sessions: Map<string, { session: { runStream: unknown } }> };

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function setup() {
  const path = tmpDbPath("chat-stop-settle");
  const db = openDatabase(path);
  const svc = new ChatSessionService(db);
  return {
    db,
    svc,
    cleanup: async () => {
      await svc.disposeAll();
      db.close();
      rmDbFiles(path);
    },
  };
}

/** A run that unwinds slowly after its abort (a provider call that only notices the signal late). */
const slowUnwindStream = (unwindMs: number, fail = false) =>
  async function* (_msg: string, opts: { signal?: AbortSignal }): AsyncGenerator<FakeEvent> {
    yield { _tag: "TextDelta", text: "half" };
    await new Promise<void>((r) => opts.signal?.addEventListener("abort", () => r(), { once: true }));
    await sleep(unwindMs);
    if (fail) throw new Error("LLM stream failed: Unable to connect");
  };

/** Start a chat turn the way the route does (pumped in the background) and wait until it is running. */
async function startTurn(svc: ChatSessionService, id: string, unwindMs: number, fail = false) {
  (svc as unknown as Internal).sessions.get(id)!.session.runStream = slowUnwindStream(unwindMs, fail);
  const events: FakeEvent[] = [];
  const done = (async () => {
    for await (const e of svc.chatStream(id, "go")) events.push(e as FakeEvent);
  })();
  while (events.length === 0) await sleep(5);
  return { events, done };
}

describe("Stop then edit", () => {
  it("rewind right after the Stop response succeeds (no busy error); the in-flight guard is released", async () => {
    const { db, svc, cleanup } = setup();
    try {
      const id = await svc.createSession({ agentConfig: { provider: "test", model: "test-model", enableTools: true } });
      await svc.chat(id, "first");
      const first = getChatTurns(db, id).find((t) => t.role === "user")!;
      const turn = await startTurn(svc, id, 150);

      const out = await interruptChatTurnSettled(svc, id, "stop");
      expect(out.stopped).toBe(true);
      expect(out.settled).toBe(true);
      expect(svc.isBusy(id)).toBe(false);

      const rewound = await svc.rewind(id, first.id);
      expect(rewound.userMessage).toBe("first");
      await turn.done;
    } finally {
      await cleanup();
    }
  });

  it("an edit issued BEFORE the Stop response (the race) waits for the release instead of failing busy", async () => {
    const { db, svc, cleanup } = setup();
    try {
      const id = await svc.createSession({ agentConfig: { provider: "test", model: "test-model", enableTools: true } });
      await svc.chat(id, "first");
      const first = getChatTurns(db, id).find((t) => t.role === "user")!;
      const turn = await startTurn(svc, id, 150);

      expect(svc.stopTurn(id)).toBe(true); // aborted, still unwinding
      expect(svc.isBusy(id)).toBe(true);
      const rewound = await svc.rewind(id, first.id); // would have thrown ChatSessionBusyError
      expect(rewound.userMessage).toBe("first");
      expect(svc.isBusy(id)).toBe(false);
      await turn.done;
    } finally {
      await cleanup();
    }
  });

  it("a turn that is NOT stopping still answers busy (a live run is never edited under)", async () => {
    const { svc, cleanup } = setup();
    try {
      const id = await svc.createSession({ agentConfig: { provider: "test", model: "test-model", enableTools: true } });
      await svc.chat(id, "first");
      const turn = await startTurn(svc, id, 0);
      await expect(svc.rewind(id, 1)).rejects.toBeInstanceOf(ChatSessionBusyError);
      svc.stopTurn(id);
      await turn.done;
    } finally {
      await cleanup();
    }
  });

  it("the guard clears when the aborted run's stream FAILS (provider unreachable), so the edit still succeeds", async () => {
    const { db, svc, cleanup } = setup();
    try {
      const id = await svc.createSession({ agentConfig: { provider: "test", model: "test-model", enableTools: true } });
      await svc.chat(id, "first");
      const first = getChatTurns(db, id).find((t) => t.role === "user")!;
      const turn = await startTurn(svc, id, 50, true);
      const out = await interruptChatTurnSettled(svc, id, "stop");
      expect(out.settled).toBe(true);
      expect(svc.isBusy(id)).toBe(false);
      await svc.rewind(id, first.id);
      await turn.done;
    } finally {
      await cleanup();
    }
  });

  it("the guard clears on a normal end and after a pre-run failure", async () => {
    const { svc, cleanup } = setup();
    try {
      const id = await svc.createSession({ agentConfig: { provider: "test", model: "test-model", enableTools: false } });
      for await (const _ of svc.chatStream(id, "hi")) void _;
      expect(svc.isBusy(id)).toBe(false);
      (svc as unknown as { getOrBuildSession: () => Promise<never> }).getOrBuildSession = async () => {
        throw new Error("LLMError: provider not configured");
      };
      for await (const _ of svc.chatStream(id, "again")) void _;
      expect(svc.isBusy(id)).toBe(false);
    } finally {
      await cleanup();
    }
  });
});

describe("ChatTurnStops.settleIfStopping", () => {
  it("resolves true at once with no turn or a running (not aborted) turn", async () => {
    const stops = new ChatTurnStops();
    expect(await stops.settleIfStopping("s")).toBe(true);
    const h = stops.begin("s");
    expect(await stops.settleIfStopping("s", 10)).toBe(true);
    h.end();
  });

  it("times out (false) when the aborted turn never ends, and resolves true once it ends", async () => {
    const stops = new ChatTurnStops();
    const h = stops.begin("s");
    stops.stop("s");
    expect(await stops.settleIfStopping("s", 20)).toBe(false);
    setTimeout(() => h.end(), 20);
    expect(await stops.settleIfStopping("s", 1000)).toBe(true);
  });
});
