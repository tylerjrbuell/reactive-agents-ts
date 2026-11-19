// Run: bun run repo test apps/cortex/server/tests/chat-code-action-card.test.ts
/**
 * A REAL code-action chat turn (scripted test provider, sandbox executes the code) keeps its strategy
 * card: the StepEvents `chatStream` drains to the client are the ones the stored turn must hold, so the
 * card survives the turn ending and a reload. Regression: the drained steps reached the client but never
 * the turn's `TurnTraceRecorder`, so the stored turn had no `strategyRun` and the card vanished at settle.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { strategyStepFromWire, type StrategyRunState } from "@reactive-agents/ui-core";
import type { ChatStreamEvent } from "../services/chat-detached-turn.js";
import { openDatabase } from "../db/schema.js";
import { getChatTurns } from "../db/chat-queries.js";
import { ChatSessionService } from "../services/chat-session-service.js";
import { rmDbFiles, tmpDbPath } from "./helpers/tmp-db.js";

const DB_PATH = tmpDbPath("chat-code-action-card");
const fence = (code: string) => "```typescript\n" + code + "\n```";
let db: ReturnType<typeof openDatabase>;
let svc: ChatSessionService;

beforeAll(() => {
  db = openDatabase(DB_PATH);
  svc = new ChatSessionService(db);
});
afterAll(() => {
  db.close();
  rmDbFiles(DB_PATH);
});

async function turn(script: readonly object[], opts: { maxIterations?: number } = {}) {
  const id = await svc.createSession({
    name: "code-action-card",
    agentConfig: {
      provider: "test",
      model: "test-model",
      enableTools: true,
      askBeforeRiskyTools: false,
      strategy: "code-action",
      maxIterations: opts.maxIterations ?? 4,
      testScenario: script,
    },
  });
  const events: ChatStreamEvent[] = [];
  for await (const e of svc.chatStream(id, "Compute something with code.")) events.push(e);
  const assistant = getChatTurns(db, id).filter((t) => t.role === "assistant").at(-1);
  return { events, assistant };
}

const stepsOf = (events: readonly ChatStreamEvent[]) =>
  events.flatMap((e) => (e._tag === "StepEvent" ? [strategyStepFromWire(e.step)!] : []));

describe("code-action strategy card persists with the stored turn", () => {
  it("a successful run stores phases, the code and the verify payload", async () => {
    const { events, assistant } = await turn([{ text: fence("(async () => 'the answer is 42')()") }]);
    const streamed = stepsOf(events);
    expect(streamed.map((s) => s.pass)).toContain("code-action:plan");
    const run = assistant?.trace?.strategyRun as StrategyRunState | undefined;
    expect(run, "stored turn has no strategyRun").toBeDefined();
    expect(run!.strategy).toBe("code-action");
    expect(run!.ended).toBe(true);
    expect(run!.rows.map((r) => r.phase)).toEqual(expect.arrayContaining(["plan", "execute", "verify"]));
    expect(run!.rows.some((r) => (r.code ?? "").includes("the answer is 42"))).toBe(true);
    expect(run!.rows.some((r) => r.verify !== undefined)).toBe(true);
  }, 60_000);

  it("a run whose code throws and retries stores both attempts, the stderr and the retry code", async () => {
    const { assistant } = await turn([
      { text: fence("(async () => { throw new Error('boom-first'); })()") },
      { text: fence("(async () => 'recovered answer')()") },
    ]);
    const run = assistant?.trace?.strategyRun as StrategyRunState | undefined;
    expect(run, "stored turn has no strategyRun").toBeDefined();
    expect(run!.rows.some((r) => (r.stderr ?? "").includes("boom-first"))).toBe(true);
    expect(run!.rows.some((r) => r.phase === "execute" && r.n === 2)).toBe(true);
    expect(run!.rows.some((r) => (r.code ?? "").includes("recovered answer"))).toBe(true);
  }, 60_000);

  it("a run that fails every attempt still stores its card", async () => {
    const bad = { text: fence("(async () => { throw new Error('boom-a'); })()") };
    const { assistant } = await turn([bad, { text: fence("(async () => { throw new Error('boom-b'); })()") }, bad], { maxIterations: 2 });
    const run = assistant?.trace?.strategyRun as StrategyRunState | undefined;
    expect(run, "failed run stored no strategyRun").toBeDefined();
    expect(run!.rows.some((r) => (r.stderr ?? "").includes("boom-"))).toBe(true);
  }, 60_000);
});
