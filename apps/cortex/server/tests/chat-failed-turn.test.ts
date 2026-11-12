// Run: bun run repo test apps/cortex/server/tests/chat-failed-turn.test.ts
//
// Replays the shape of trace 01M73GNDMGG0TMZD9JS78NASAC (2026-11-10, mimo-v2.6 on
// Ollama): ThoughtEmitted carries kernel STEP indexes, a tool fails then is fixed, and
// the run ends llm_error with the model's last narration as its output. Pins:
//  - the persisted turn rebuilds into steps with no phantom repeats,
//  - the failed turn is stored as failed, with the kernel's cause,
//  - the next turn's DB-seeded history never carries the narration as an answer,
//  - the titler never sees it as a reply.
import { describe, expect, it } from "bun:test";
import { rmDbFiles, tmpDbPath } from "./helpers/tmp-db.js";
import { persistedTurnStepsOf } from "@reactive-agents/ui-core";
import { openDatabase } from "../db/schema.js";
import { getChatTurns, renameSession } from "../db/chat-queries.js";
import { ChatSessionService, turnsToChatMessages } from "../services/chat-session-service.js";
import { historyContentOf } from "../services/chat-turn-trace.js";
import { recordRunErrors, type RunErrorLog } from "../services/chat-run-errors.js";
import type { AgentEvent } from "@reactive-agents/core";

const NARRATION = "I've been getting a traffic snapshot. Let me pull sessions and events for the period.";
const KERNEL_CAUSE =
  "LLM stream failed at iteration 7: ollama call failed (ollama:mimo-v2.6:latest): XML syntax error on line 1: unexpected EOF";

type Ev = Record<string, unknown>;
const progress = (iteration: number): Ev => ({ _tag: "IterationProgress", iteration, maxIterations: 10, status: "r" });
const call = (id: string, toolName: string, ok: boolean, error?: string): Ev[] => [
  { _tag: "ToolCallStarted", toolName, callId: id },
  { _tag: "ToolCallCompleted", toolName, callId: id, durationMs: 5, success: ok, ...(error ? { error } : {}) },
];

const failedTurn: Ev[] = [
  { _tag: "ThoughtEmitted", iteration: 2, content: "I'll find your umami docs site." },
  progress(0),
  ...call("c1", "umami/list_websites", true),
  progress(1),
  { _tag: "ThinkingEmitted", iteration: 1, content: "Pull the metrics." },
  { _tag: "ThoughtEmitted", iteration: 6, content: "Pull the metrics." },
  progress(1),
  ...call("c2", "umami/get_website_metrics", false, '[Tool error: Missing required parameter "type"]'),
  progress(2),
  progress(2),
  ...call("c3", "umami/get_website_metrics", true),
  progress(3),
  { _tag: "ThinkingEmitted", iteration: 3, content: NARRATION },
  { _tag: "ThoughtEmitted", iteration: 10, content: NARRATION },
  progress(3),
  { _tag: "TextDelta", text: NARRATION },
  // The kernel kept the model's last text as output (still allowed on a failed run); the cause rides `error`.
  {
    _tag: "StreamCompleted",
    output: NARRATION,
    metadata: { tokensUsed: 10 },
    taskId: "run-f",
    success: false,
    terminatedBy: "llm_error",
    error: KERNEL_CAUSE,
  },
];

type Internal = { sessions: Map<string, { session: { runStream: unknown }; runErrors?: RunErrorLog }> };

describe("a failed chat turn (01M73GND shape)", () => {
  it("is stored failed with steps intact, and stays out of the next turn's history and the title", async () => {
    const path = tmpDbPath("chat-failed-turn");
    const db = openDatabase(path);
    const titled: string[] = [];
    const svc = new ChatSessionService(db, {
      title: async (_u, reply) => {
        titled.push(reply);
        return "";
      },
    });
    try {
      const id = await svc.createSession({ agentConfig: { provider: "test", model: "test-model", enableTools: true } });
      await svc.chat(id, "warm");
      renameSession(db, id, "New Chat");
      titled.length = 0;
      const sessions = (svc as unknown as Internal).sessions;
      const entry = sessions.get(id)!;
      entry.session.runStream = async function* (): AsyncGenerator<Ev> {
        yield* failedTurn;
      };
      sessions.set(id, { ...entry, runErrors: { errorOf: (runId) => (runId === "run-f" ? KERNEL_CAUSE : undefined) } });

      for await (const _ of svc.chatStream(id, "Help me run analytics on my umami docs site")) {
        /* drain */
      }

      const turns = getChatTurns(db, id);
      const last = turns.filter((t) => t.role === "assistant").at(-1)!;
      expect(last.trace?.outcome).toEqual({ success: false, ending: "failed", terminatedBy: "llm_error", error: KERNEL_CAUSE });

      // Cortex stores its own `outcome` shape; the steps view reads the rest of the trace.
      const { outcome: _stored, ...trace } = last.trace!;
      const steps = persistedTurnStepsOf(trace, last.content);
      expect(steps.flatMap((s) => s.iterations)).toEqual([0, 1, 2, 3]);
      expect(steps.map((s) => s.label)).toEqual([
        "list_websites",
        "get_website_metrics ×2 · 1 failed → ok",
        "No tool call",
      ]);
      expect(steps.filter((s) => s.narration === NARRATION)).toHaveLength(0);

      const history = turnsToChatMessages(turns);
      expect(history.some((m) => m.content.includes(NARRATION))).toBe(false);
      expect(history.at(-1)).toMatchObject({
        role: "assistant",
        content: `[The previous run failed (llm_error): ${KERNEL_CAUSE}. No answer was given.]`,
      });
      expect(titled).toEqual([""]);
      await svc.disposeAll();
    } finally {
      db.close();
      rmDbFiles(path);
    }
  });

  it("historyContentOf passes a successful reply through", () => {
    expect(historyContentOf({ content: "answer" })).toBe("answer");
  });

  it("the kernel's ReasoningFailed cause wins over AgentCompleted.error holding narration", async () => {
    let handler: ((e: AgentEvent) => void) | undefined;
    const { log } = await recordRunErrors({
      subscribe: async (h: (e: AgentEvent) => void) => {
        handler = h;
        return () => undefined;
      },
    });
    const emit = (e: Ev) => handler?.(e as unknown as AgentEvent);
    emit({ _tag: "ReasoningFailed", taskId: "run-f", error: KERNEL_CAUSE, iteration: 7 });
    emit({ _tag: "AgentCompleted", taskId: "run-f", success: false, error: NARRATION });
    expect(log.errorOf("run-f")).toBe(KERNEL_CAUSE);
  });
});
