// Run: bun test packages/runtime/tests/seam-channel-session-reset.test.ts
//
// Seam pin: the runtime resolver's RoutedSession.reset empties the PERSISTED per-conversation chat
// history (not only the in-memory copy), so the next open() for the same conversationKey starts
// empty, including from a freshly built agent on the same DB (a restart). Stateless sessions have
// no history and offer no reset. A store failure maps to RoutingError turn_failed.
import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Effect } from "effect";
import type { OpenSessionRequest, RoutedSession, RoutedTurn } from "@reactive-agents/channels";
import { makeChannelAgentResolver, type ChannelAgentHandle } from "../src/agent/channel-router-resolver.js";
import { ReactiveAgents } from "../src/builder.js";

const req: OpenSessionRequest = {
  routeId: "r1",
  role: "owner",
  target: { agentId: "a" },
  toolExposure: { _tag: "AgentDefault" },
  conversationKey: "chat-1",
  stateless: false,
};

const turn = (t: string): RoutedTurn => ({
  text: t,
  parts: [],
  taskId: "t1",
  sender: { platform: "telegram", userId: "1" },
  approval: { request: () => Effect.succeed("denied" as const) },
  message: { id: "m1", platform: "telegram", channelId: "chat-1", senderId: "1", content: t, metadata: {}, timestamp: new Date(0) },
});

const makeResolver = (dbPath: string) =>
  makeChannelAgentResolver({
    agents: { a: () => ReactiveAgents.create().withProvider("test").withMemory({ dbPath }) },
  });

/** Open, run `body`, close the scope (runs the session's close-time `end()`). */
const withOpen = async <A>(
  resolver: ReturnType<typeof makeResolver>,
  r: OpenSessionRequest,
  body: (s: RoutedSession) => Promise<A>,
): Promise<A> =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const s = yield* resolver.open(r);
        return yield* Effect.promise(() => body(s));
      }),
    ),
  );

describe("seam: channel resolver session reset", () => {
  let tmpDir: string | undefined;
  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  });

  test("reset empties persisted history; reopen and restart start empty", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ra-chan-reset-"));
    const dbPath = path.join(tmpDir, "sessions.db");
    const resolverA = makeResolver(dbPath);
    try {
      // Turns persist and survive a reopen (control: proves the history is really there).
      await withOpen(resolverA, req, async (s) => {
        await Effect.runPromise(s.send(turn("I only have crypto and recall")));
      });
      await withOpen(resolverA, req, async (s) => {
        await Effect.runPromise(s.send(turn("what do I have?")));
      });

      // Restart view: a fresh agent on the same DB loads the stored record on its first turn.
      const storedAfterRestart = async (): Promise<string[]> => {
        const agent = await ReactiveAgents.create().withProvider("test").withMemory({ dbPath }).build();
        try {
          const fresh = agent.session({ persist: true, id: "r1:owner:chat-1" });
          await fresh.chat("ping");
          return fresh.history().map((m) => m.content);
        } finally {
          await agent.dispose();
        }
      };

      // Reset the LIVE session that holds history (its end() saves the old history, so only the
      // explicit clear empties the store), and read the store BEFORE the scope closes.
      await withOpen(resolverA, req, async (s) => {
        await Effect.runPromise(s.send(turn("still here")));
        expect(s.reset).toBeDefined();
        await Effect.runPromise(s.reset!);
        const mid = await storedAfterRestart();
        expect(mid.join(" ")).not.toContain("crypto");
        expect(mid.join(" ")).not.toContain("still here");
        expect(mid.length).toBe(2);
      });

      // After the scope closes (close-time end()), reopening still starts empty.
      const after = await storedAfterRestart();
      expect(after.join(" ")).not.toContain("crypto");
      expect(after.join(" ")).not.toContain("still here");
    } finally {
      await Effect.runPromise(resolverA.disposeAll);
    }
  }, 60000);

  test("stateless sessions offer no reset", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ra-chan-reset-sl-"));
    const resolver = makeResolver(path.join(tmpDir, "sessions.db"));
    try {
      await withOpen(resolver, { ...req, stateless: true }, async (s) => {
        expect(s.reset).toBeUndefined();
      });
    } finally {
      await Effect.runPromise(resolver.disposeAll);
    }
  }, 30000);

  test("a store failure maps to RoutingError turn_failed (classification only)", async () => {
    const handle: ChannelAgentHandle = {
      agentId: "a",
      dispose: async () => undefined,
      session: () => ({ chat: async () => ({ message: "x" }), end: async () => undefined }),
      clearSessionHistory: () => Promise.reject({ _tag: "DatabaseError" }),
      run: async () => ({ output: "", agentId: "a", taskId: "t", metadata: { tokensUsed: 0, cost: 0 } }),
    };
    const resolver = makeChannelAgentResolver({
      agents: { a: () => ReactiveAgents.create().withProvider("test") },
      build: async () => handle,
    });
    await withOpen(resolver, req, async (s) => {
      const exit = await Effect.runPromise(Effect.either(s.reset!));
      expect(exit._tag).toBe("Left");
      if (exit._tag === "Left") expect(exit.left.reason).toBe("turn_failed");
    });
  }, 30000);
});
