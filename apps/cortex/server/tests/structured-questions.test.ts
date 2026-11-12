// Run: bun test apps/cortex/server/tests/structured-questions.test.ts --timeout 30000
//
// Structured `request_user_input` (several typed questions, id-keyed answer map):
// the questions survive from the agent's ask to the pending-interaction lists, a bad
// answer map is refused with what to fix BEFORE it reaches the waiting run, and a good
// one goes through unchanged. Legacy kind + schema asks are not checked.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { Elysia } from "elysia";
import { Effect, Layer } from "effect";
import type { AgentStreamEvent } from "@reactive-agents/runtime";
import type { InteractionQuestion } from "@reactive-agents/core";
import { applySchema } from "../db/schema.js";
import { CortexStoreServiceLive } from "../services/store-service.js";
import { CortexRunnerService } from "../services/runner-service.js";
import { runsRouter } from "../api/runs.js";
import { ChatSessionService } from "../services/chat-session-service.js";
import { answerText } from "../services/chat-approvals.js";
import { durableApprovals } from "../services/durable-approvals.js";
import { checkInteractionAnswer, questionsOfPending } from "../services/interaction-answers.js";

const QUESTIONS: readonly InteractionQuestion[] = [
  { id: "env", prompt: "Which environment?", type: "single-choice", options: [{ label: "Staging", value: "stg" }, { label: "Production", value: "prod" }] },
  { id: "checks", prompt: "Which checks?", type: "multi-choice", min: 1, options: [{ label: "Lint", value: "lint" }, { label: "Tests", value: "test" }] },
  { id: "go", prompt: "Proceed?", type: "boolean" },
  { id: "n", prompt: "How many replicas?", type: "number", min: 1, max: 5 },
  { id: "why", prompt: "Reason?", type: "text", required: false },
];
const GOOD = { env: "stg", checks: ["lint", "test"], go: true, n: 2 };

describe("checkInteractionAnswer", () => {
  it("passes a valid id-keyed map and names each problem by question prompt", () => {
    expect(checkInteractionAnswer(QUESTIONS, GOOD)).toEqual({ ok: true });
    const bad = checkInteractionAnswer(QUESTIONS, { env: "mars", checks: [], go: "yes", n: 9 });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.error).toContain("Which environment?");
    expect(bad.error).toContain("How many replicas?");
    expect(bad.error).toContain("Proceed?");
  });

  it("a structured ask refuses a bare string; a legacy ask (no questions) is not checked", () => {
    expect(checkInteractionAnswer(QUESTIONS, "stg").ok).toBe(false);
    expect(checkInteractionAnswer([], "blue")).toEqual({ ok: true });
  });

  it("reads the questions from the wire field, else from a durable pause's persisted schema", () => {
    expect(questionsOfPending({ questions: QUESTIONS })).toBe(QUESTIONS);
    expect(questionsOfPending({ schema: { questions: QUESTIONS } })).toEqual(QUESTIONS);
    expect(questionsOfPending({ schema: { options: ["a"] } })).toEqual([]);
    expect(questionsOfPending({ schema: null })).toEqual([]);
  });
});

describe("answerText for a structured answer", () => {
  it("reads question: option label per line, in the order asked", () => {
    expect(answerText({ go: true, env: "prod", checks: ["lint", "test"], n: 2 }, QUESTIONS)).toBe(
      "Which environment?: Production\nWhich checks?: Lint, Tests\nProceed?: Yes\nHow many replicas?: 2",
    );
    expect(answerText({ name: "Ada" })).toBe("name: Ada");
  });
});

describe("POST /api/runs/:runId/interaction with a structured ask", () => {
  const delivered: unknown[] = [];
  const runner = Layer.succeed(CortexRunnerService, {
    resumeCrashed: () => Effect.succeed({ agentId: "a", runId: "r" }),
    start: () => Effect.succeed({ agentId: "a", runId: "r" }),
    pause: () => Effect.void,
    resume: () => Effect.void,
    stop: () => Effect.void,
    terminate: () => Effect.void,
    getActive: () => Effect.succeed(new Map()),
    listPendingApprovals: () => Effect.succeed([]),
    approveApproval: () => Effect.void,
    denyApproval: () => Effect.void,
    listPendingInteractions: () =>
      Effect.succeed([
        { runId: "r1", interactionId: "i1", kind: "form", prompt: "Deploy", schema: {}, questions: QUESTIONS, task: "t", updatedAt: 1 },
        { runId: "r2", interactionId: "i2", kind: "choice", prompt: "Pick", schema: { options: ["a"] }, task: "t", updatedAt: 1 },
      ]),
    respondToInteraction: (_run, _id, value) => {
      delivered.push(value);
      return Effect.succeed({ success: true, output: "" });
    },
  });
  const app = () => {
    const db = new Database(":memory:");
    applySchema(db);
    return new Elysia().use(runsRouter(CortexStoreServiceLive(db), runner));
  };
  const post = (runId: string, interactionId: string, value: unknown) =>
    app().handle(
      new Request(`http://localhost/api/runs/${runId}/interaction`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interactionId, value }),
      }),
    );

  it("lists the questions with the pending interaction", async () => {
    const res = await app().handle(new Request("http://localhost/api/runs/pending-interactions"));
    const json = (await res.json()) as { interactions: { interactionId: string; questions?: unknown }[] };
    expect(json.interactions.find((i) => i.interactionId === "i1")?.questions).toEqual(QUESTIONS as never);
    expect(json.interactions.find((i) => i.interactionId === "i2")).not.toHaveProperty("questions");
  });

  it("refuses a bad answer map with what to fix and delivers nothing; a good one goes through unchanged", async () => {
    delivered.length = 0;
    const bad = await post("r1", "i1", { env: "mars", go: "maybe" });
    expect(bad.status).toBe(422);
    expect(((await bad.json()) as { error: string }).error).toContain("Which environment?");
    expect(delivered).toEqual([]);

    const ok = await post("r1", "i1", GOOD);
    expect(ok.status).toBe(200);
    expect(delivered).toEqual([GOOD]);
  });

  it("a legacy answer is delivered as before", async () => {
    delivered.length = 0;
    expect((await post("r2", "i2", "a")).status).toBe(200);
    expect(delivered).toEqual(["a"]);
  });
});

describe("a chat turn asking a structured question live", () => {
  let db: Database;
  let svc: ChatSessionService;
  beforeAll(() => {
    db = new Database(":memory:");
    applySchema(db);
    svc = new ChatSessionService(db);
  });
  afterAll(async () => {
    await svc.disposeAll();
    db.close();
  });

  it("streams the typed questions, lists them for the desk, and the same turn finishes with the id-keyed answer", async () => {
    const id = await svc.createSession({
      agentConfig: {
        provider: "test",
        strategy: "reactive",
        maxIterations: 4,
        tools: ["file-read"],
        testScenario: [
          { toolCall: { name: "request_user_input", args: { prompt: "Deploy details", questions: QUESTIONS } } },
          { match: "stg", text: "Deploying to stg. FINAL." },
          { text: "fallback" },
        ],
      },
    });
    const events: AgentStreamEvent[] = [];
    for await (const ev of svc.chatStream(id, "deploy it")) {
      events.push(ev);
      if (ev._tag === "InteractionRequested") {
        expect(ev.questions?.map((q) => q.id)).toEqual(["env", "checks", "go", "n", "why"]);
        const listed = (await durableApprovals.listLiveInteractions()).find((r) => r.interactionId === ev.interactionId);
        expect(listed?.questions?.map((q) => q.id)).toEqual(["env", "checks", "go", "n", "why"]);
        expect(await durableApprovals.answerLiveInteraction(ev.runId, ev.interactionId, GOOD)).toEqual({ ok: true });
      }
    }
    expect(events.some((e) => e._tag === "InteractionRequested")).toBe(true);
    const done = events.find((e): e is Extract<AgentStreamEvent, { _tag: "StreamCompleted" }> => e._tag === "StreamCompleted");
    expect(done?.output).toContain("Deploying to stg");
    await svc.deleteSession(id);
  }, 30_000);
});
