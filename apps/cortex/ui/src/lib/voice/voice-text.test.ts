import { describe, expect, test } from "bun:test";
import { replyEventOf, transcriptMarkdown, voiceQuestionOf, waitingOf, type VoiceTurnLike } from "./voice-text.js";

const user = (content: string): VoiceTurnLike => ({ role: "user", content });
const agent = (content: string, extra: Partial<VoiceTurnLike> = {}): VoiceTurnLike => ({ role: "assistant", content, ...extra });

describe("transcriptMarkdown", () => {
  test("labels who speaks, skips empty and streaming turns", () => {
    const t = transcriptMarkdown([user("Hi"), agent("Hello **there**"), agent("", {}), agent("partial", { streaming: true })]);
    expect(t).toBe("You said.\n\nHi\n\nThe agent replied.\n\nHello **there**");
  });
  test("never reads a leaked reasoning preface aloud", () => {
    const leak = agent("thought The user wants a plan. I will list steps.\nHere's the plan:\n1. One");
    expect(transcriptMarkdown([leak])).toBe("The agent replied.\n\nHere's the plan:\n1. One");
  });
  test("an empty conversation reads nothing", () => {
    expect(transcriptMarkdown([])).toBe("");
  });
});

describe("waitingOf", () => {
  test("approval, question, or nothing, from the latest assistant turn", () => {
    expect(waitingOf([user("x"), agent("", { liveApproval: { runId: "r" } })])).toBe("approval");
    expect(waitingOf([agent("", { awaitingApproval: true })])).toBe("approval");
    expect(waitingOf([agent("", { liveInteraction: { q: 1 } })])).toBe("question");
    expect(waitingOf([agent("", { liveInteraction: {}, liveApproval: {} })])).toBe("question");
    expect(waitingOf([user("x")])).toBeNull();
    expect(waitingOf([agent("")])).toBeNull();
  });
});

describe("replyEventOf", () => {
  const sending = { sending: true, turns: [user("q"), agent("")] };
  test("a finished run with an answer is a reply", () => {
    expect(replyEventOf(sending, { sending: false, turns: [user("q"), agent("  The answer.  ")] })).toEqual({ type: "reply", text: "The answer." });
  });
  test("a finished run with no text still ends the turn", () => {
    expect(replyEventOf(sending, { sending: false, turns: [user("q"), agent("")] })).toEqual({ type: "reply", text: "The agent finished." });
  });
  test("a failed run or a store error is a failure", () => {
    expect(replyEventOf(sending, { sending: false, turns: [user("q"), agent("", { runFailed: { ending: "failed" } })] })?.type).toBe("reply-failed");
    expect(replyEventOf(sending, { sending: false, turns: [user("q"), agent("")], error: "Model offline" })).toEqual({ type: "reply-failed", message: "Model offline" });
  });
  test("a stopped turn, a run still going, and idle updates give nothing", () => {
    expect(replyEventOf(sending, { sending: false, turns: [user("q"), agent("part", { cancelled: true })] })).toBeNull();
    expect(replyEventOf(sending, sending)).toBeNull();
    expect(replyEventOf({ sending: false, turns: [] }, { sending: false, turns: [user("q")] })).toBeNull();
  });
});

describe("voiceQuestionOf", () => {
  const ask = (extra: Record<string, unknown> = {}) => ({ runId: "r", interactionId: "i1", kind: "choice", prompt: "Which one?", schema: { options: ["A", "B"] }, ...extra });
  test("a streaming turn's live question becomes a voice question with its spec", () => {
    expect(voiceQuestionOf([user("x"), agent("", { streaming: true, liveInteraction: ask() })])).toEqual({
      id: "i1",
      prompt: "Which one?",
      spec: { kind: "choice", options: ["A", "B"] },
    });
    expect(voiceQuestionOf([agent("", { streaming: true, liveInteraction: ask({ kind: "confirmation" }) })])?.spec).toEqual({ kind: "boolean" });
    expect(voiceQuestionOf([agent("", { streaming: true, liveInteraction: ask({ kind: "text" }) })])?.spec).toEqual({ kind: "text" });
  });
  test("no question, a finished turn, a blank prompt, or only an approval gives nothing", () => {
    expect(voiceQuestionOf([user("x")])).toBeNull();
    expect(voiceQuestionOf([agent("", { liveInteraction: ask() })])).toBeNull();
    expect(voiceQuestionOf([agent("", { streaming: true, liveInteraction: ask({ prompt: "  " }) })])).toBeNull();
    expect(voiceQuestionOf([agent("", { streaming: true, liveApproval: { runId: "r" } })])).toBeNull();
  });
});
