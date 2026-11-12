import { describe, expect, test } from "bun:test";
import type { UiStreamEvent } from "@reactive-agents/ui-core";
import { buildAnswers, questionsOf } from "./structured-questions.js";
import { answerLiveInteraction, liveInteractionAfter, orphanChatInteractions, type LiveInteraction } from "./chat-live-interaction.js";

const ask: UiStreamEvent = {
  _tag: "InteractionRequested",
  runId: "r1",
  interactionId: "i1",
  kind: "choice",
  prompt: "Which?",
  schema: { options: ["a", "b"] },
};
const q: LiveInteraction = { runId: "r1", interactionId: "i1", kind: "choice", prompt: "Which?", schema: { options: ["a", "b"] } };

describe("liveInteractionAfter", () => {
  test("a question sets it; starting a tool does not clear it (the ask is a tool call)", () => {
    const set = liveInteractionAfter(undefined, ask);
    expect(set).toEqual(q);
    expect(liveInteractionAfter(set, { _tag: "ToolCallStarted", toolName: "request_user_input", callId: "c" })).toBe(set);
    expect(liveInteractionAfter(set, { _tag: "PhaseStarted", phase: "think", timestamp: 0 })).toBe(set);
  });

  test("a structured ask keeps its typed questions", () => {
    const questions = [{ id: "env", prompt: "Where?", type: "single-choice" as const, options: [{ label: "Staging", value: "stg" }] }];
    const set = liveInteractionAfter(undefined, { ...ask, kind: "form", schema: {}, questions } as UiStreamEvent);
    expect(set?.questions).toEqual(questions);
    expect(liveInteractionAfter(undefined, ask)).not.toHaveProperty("questions");
  });

  test("the run moving on clears it", () => {
    for (const ev of [
      { _tag: "ToolCallCompleted", toolName: "request_user_input", callId: "c", durationMs: 1, success: true },
      { _tag: "TextDelta", text: "ok" },
      { _tag: "StreamError", cause: "x" },
    ] as UiStreamEvent[]) {
      expect(liveInteractionAfter(q, ev)).toBeUndefined();
    }
    expect(liveInteractionAfter(undefined, { _tag: "TextDelta", text: "x" })).toBeUndefined();
  });
});

describe("orphanChatInteractions", () => {
  test("a chat's waiting question that no streaming turn shows", () => {
    const rows = [
      { ...q, chatSessionId: "s1" },
      { ...q, runId: "r2", chatSessionId: "s1" },
      { ...q, runId: "r3", chatSessionId: "s2" },
      { ...q, runId: "r4" },
    ];
    expect(orphanChatInteractions("s1", rows, new Set(["r1"])).map((r) => r.runId)).toEqual(["r2"]);
  });
});

describe("a multi-part structured question, wire event to answer map", () => {
  test("the event's questions fill the form's draft and the id-keyed map reaches the interaction route", async () => {
    const event = {
      _tag: "InteractionRequested",
      runId: "r9",
      interactionId: "i9",
      kind: "form",
      prompt: "Deploy details",
      schema: {},
      questions: [
        { id: "env", prompt: "Where?", type: "single-choice", options: [{ label: "Staging", value: "stg" }, { label: "Production", value: "prod" }] },
        { id: "checks", prompt: "Checks?", type: "multi-choice", options: [{ label: "Lint", value: "lint" }, { label: "Tests", value: "test" }] },
        { id: "go", prompt: "Proceed?", type: "boolean" },
        { id: "n", prompt: "Replicas?", type: "number", min: 1 },
        { id: "why", prompt: "Why?", type: "text", required: false },
      ],
    } as UiStreamEvent;
    const live = liveInteractionAfter(undefined, event);
    const questions = questionsOf(live ?? {});
    expect(questions.map((x) => x.id)).toEqual(["env", "checks", "go", "n", "why"]);
    const built = buildAnswers(questions, { env: "stg", checks: ["lint", "test"], go: "yes", n: "2" });
    expect(built.ok).toBe(true);
    if (!built.ok || live === undefined) throw new Error("expected a built answer map");
    let sent: unknown;
    const f = (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ success: true, output: "" }));
    }) as unknown as typeof fetch;
    expect(await answerLiveInteraction(live, built.answers, f)).toEqual({ ok: true });
    expect(sent).toEqual({ interactionId: "i9", value: { env: "stg", checks: ["lint", "test"], go: true, n: 2 } });
  });
});

describe("answerLiveInteraction", () => {
  const reply = (status: number, body: object): typeof fetch =>
    (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  test("posts the answer to the run's interaction route", async () => {
    let seen: { url: string; body: unknown } | undefined;
    const f = (async (url: string, init: RequestInit) => {
      seen = { url, body: JSON.parse(String(init.body)) };
      return new Response(JSON.stringify({ success: true, output: "" }));
    }) as unknown as typeof fetch;
    expect(await answerLiveInteraction(q, "blue", f)).toEqual({ ok: true });
    expect(seen?.url).toContain("/api/runs/r1/interaction");
    expect(seen?.body).toEqual({ interactionId: "i1", value: "blue" });
  });

  test("a run that is no longer waiting, a server error and a network failure say why", async () => {
    expect(await answerLiveInteraction(q, "x", reply(200, { success: false, output: "" }))).toEqual({ ok: false, error: "The agent is no longer waiting for an answer." });
    expect(await answerLiveInteraction(q, "x", reply(500, { error: "boom" }))).toEqual({ ok: false, error: "boom" });
    const down = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    expect(await answerLiveInteraction(q, "x", down)).toEqual({ ok: false, error: "offline" });
  });
});
