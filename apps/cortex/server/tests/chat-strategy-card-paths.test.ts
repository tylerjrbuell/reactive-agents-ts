// Run: bun run repo test apps/cortex/server/tests/chat-strategy-card-paths.test.ts
/**
 * The approval-decision path (`ChatApprovals.startResolve`) and the Continue path
 * (`ChatResume.startStream`) feed the session's strategy steps to the live stream AND the stored turn
 * trace, as `chatStream` does (pin `chat-code-action-card.test.ts`). Regression: both followed the bus
 * for tool calls only, so a code-action turn that paused or continued showed no card, live or after
 * reload. The agent here is a stand-in whose resumed run reports real `kernelPass` labels on its bus.
 */
import { afterAll, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { Effect } from "effect";
import type { AgentEvent } from "@reactive-agents/core";
import { RunStoreLive, RunStoreService, type AgentResult } from "@reactive-agents/runtime";
import type { StrategyRunState } from "@reactive-agents/ui-core";
import { createChatSession } from "../db/chat-queries.js";
import { applySchema } from "../db/schema.js";
import { ChatApprovals, type ApprovableAgent } from "../services/chat-approvals.js";
import type { ChatStreamEvent } from "../services/chat-detached-turn.js";
import { ChatResume, type ChatResumeHost, type ResumableAgent } from "../services/chat-resume.js";
import { attachTurnRecorders } from "../services/chat-turn-recorders.js";
import type { StoredTurnTrace } from "../services/chat-turn-trace.js";
import { ResumeGuard } from "../services/loop-stop-resume.js";
import { rmTmpDirs, tmpDir } from "./helpers/tmp-db.js";

afterAll(() => rmTmpDirs());

const result = (): AgentResult =>
  ({ output: "done", success: true, taskId: "t2", agentId: "chat-1", metadata: { duration: 1, cost: 0, tokensUsed: 5, stepsCount: 2 } }) as AgentResult;

const stepEvent = (kernelPass: string, structured?: Record<string, unknown>): AgentEvent =>
  ({ _tag: "ReasoningStepCompleted", taskId: "t2", strategy: "code-action", step: 1, totalSteps: 1, kernelPass, ...(structured ? { structured } : {}) }) as AgentEvent;

const RUN: readonly AgentEvent[] = [
  stepEvent("code-action:plan"),
  stepEvent("code-action:execute:1", { kind: "code-action", code: "(async () => 'the answer is 42')()", stdout: "42" }),
  stepEvent("code-action:verify:1", { kind: "code-action", verify: { verdict: "PASS", summary: "ok" } }),
];

/** A bus-carrying agent whose approve / deny / resume reports RUN on the bus, then ends. */
async function agentWithBus() {
  const handlers: ((e: AgentEvent) => void)[] = [];
  const subscribe = async (h: (e: AgentEvent) => void) => {
    handlers.push(h);
    return () => void handlers.splice(handlers.indexOf(h), 1);
  };
  const run = async (): Promise<AgentResult> => {
    for (const e of RUN) {
      await new Promise((r) => setTimeout(r, 2));
      for (const h of [...handlers]) h(e);
    }
    return result();
  };
  const { logs } = await attachTurnRecorders({ subscribe });
  return { subscribe, run, steps: logs.strategySteps };
}

const drain = async (events: AsyncIterable<ChatStreamEvent>): Promise<ChatStreamEvent[]> => {
  const out: ChatStreamEvent[] = [];
  for await (const e of events) out.push(e);
  return out;
};

const passesOf = (events: readonly ChatStreamEvent[]) => events.flatMap((e) => (e._tag === "StepEvent" ? [(e.step as { pass: string }).pass] : []));

function expectStoredCard(trace: StoredTurnTrace | undefined): void {
  const run = trace?.strategyRun as StrategyRunState | undefined;
  expect(run, "stored turn has no strategyRun").toBeDefined();
  expect(run!.strategy).toBe("code-action");
  expect(run!.ended).toBe(true);
  expect(run!.rows.map((r) => r.phase)).toEqual(expect.arrayContaining(["plan", "execute", "verify"]));
  expect(run!.rows.some((r) => (r.code ?? "").includes("the answer is 42"))).toBe(true);
}

describe("approval decision as a live turn keeps the strategy card", () => {
  async function decide(withSteps: boolean) {
    const a = await agentWithBus();
    const db = new Database(":memory:");
    applySchema(db);
    const persisted: (StoredTurnTrace | undefined)[] = [];
    const approvals = new ChatApprovals(db, {
      acquireTurn: () => () => {},
      agentFor: async () => ({ approveRun: a.run, denyRun: a.run, subscribe: a.subscribe }) as unknown as ApprovableAgent,
      agentIdFor: () => "chat-1",
      persistExchange: (_s, _u, _r, _res, _t, trace) => void persisted.push(trace),
      evict: async () => {},
      ...(withSteps ? { strategyStepsOf: () => a.steps } : {}),
    });
    const sessionId = createChatSession(db, { agentConfig: {}, stableAgentId: "chat-1" });
    approvals.onPaused(sessionId, "compute it", { runId: "run-a", gateId: "g1", toolName: "file-write", args: {} } as never);
    const started = await approvals.startResolve(sessionId, "run-a", "approved");
    if (!started.ok) throw new Error(started.message);
    const events = await drain(started.events);
    db.close();
    return { events, persisted };
  }

  it("streams the strategy steps before the terminal event and stores the settled card", async () => {
    const { events, persisted } = await decide(true);
    expect(passesOf(events)).toEqual(["code-action:plan", "code-action:execute:1", "code-action:verify:1"]);
    expect(events.at(-1)?._tag).toBe("StreamCompleted");
    expect(persisted).toHaveLength(1);
    expectStoredCard(persisted[0]);
  });

  it("without the session's step log nothing is streamed or stored (the bug this pins)", async () => {
    const { events, persisted } = await decide(false);
    expect(passesOf(events)).toEqual([]);
    expect(persisted[0]?.strategyRun).toBeUndefined();
  });
});

describe("Continue as a live turn keeps the strategy card", () => {
  it("streams the strategy steps and stores the settled card with the exchange", async () => {
    const dir = tmpDir("continue-card");
    await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* RunStoreService;
        yield* store.createRun({ runId: "r1", agentId: "chat-1", task: "t", configHash: "h" });
        yield* store.setStop("r1", { reason: "user", toolsDone: [], unfinished: [], iteration: 2, kind: "user-stopped" });
        yield* store.setStatus("r1", "stopped");
      }).pipe(Effect.provide(RunStoreLive(join(dir, "runs.db")))),
    );
    const a = await agentWithBus();
    const persisted: (StoredTurnTrace | undefined)[] = [];
    const host: ChatResumeHost = {
      liveAgentOf: () => undefined,
      durableSourceOf: (id) => (id === "s1" ? { agentId: "chat-1", dir } : undefined),
      acquireTurn: () => () => {},
      agentFor: async () =>
        ({ resumeRun: a.run, subscribe: a.subscribe, activeRunIds: () => [], pauseRun: async () => false, stopRun: async () => false }) as ResumableAgent,
      persistExchange: (_s, _u, _r, _res, _t, trace) => void persisted.push(trace),
      evict: async () => {},
      strategyStepsOf: () => a.steps,
    };
    const out = await new ChatResume(host, new ResumeGuard()).startStream("s1", "r1", { ok: true, options: {} });
    if (!out.ok) throw new Error(out.message);
    const events = await drain(out.events);
    expect(passesOf(events)).toEqual(["code-action:plan", "code-action:execute:1", "code-action:verify:1"]);
    expect(events.at(-1)?._tag).toBe("StreamCompleted");
    expectStoredCard(persisted[0]);
  });
});
