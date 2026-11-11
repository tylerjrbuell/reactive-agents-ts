import { describe, expect, test } from "bun:test";
import { abstentionInAnswer, bareEnding, chatTurnOutcome, completionEnding, endingBadge, endingNote, runEnding, storedRunEnding } from "./turn-ending.js";
import { turnEnding, turnTranscript } from "./stores/chat-timeline.js";
import type { ChatTurn } from "./stores/chat-store.js";

const base: ChatTurn = { id: 1, role: "assistant", content: "", tokensUsed: 0, ts: 0 };
const ABSTAINED = {
  _tag: "StreamCompleted",
  output: "",
  success: false,
  terminatedBy: "abstained",
  error: "The agent abstained: no grounded answer could be produced.",
  abstention: { reason: "no grounded answer could be produced", missing: ["web-search"] },
};

describe("an abstained turn renders as abstained, with its reason", () => {
  const ended = completionEnding(ABSTAINED);
  const turn: ChatTurn = { ...base, ...ended };

  test("completion → runFailed carries the abstained ending and reason", () => {
    expect(ended.runFailed).toEqual({
      ending: "abstained",
      terminatedBy: "abstained",
      error: ABSTAINED.error,
      abstention: ABSTAINED.abstention,
    });
  });

  test("the transcript closes with an abstained ending; the note is quiet and names the reason", () => {
    const segs = turnTranscript(turn);
    const ending = segs.find((s) => s.kind === "ending");
    expect(segs.map((s) => s.kind)).toEqual(["ending"]);
    const note = ending?.kind === "ending" ? endingNote(ending.outcome) : undefined;
    expect(note).toEqual({
      kind: "abstained",
      tone: "quiet",
      icon: "ban",
      heading: "The agent abstained",
      line: "no grounded answer could be produced",
      items: ["missing: web-search"],
    });
  });

  test("a decline the model wrote as its answer is not repeated in the note (qwen3:4b, 2026-11-11 QA)", () => {
    const answer = "I don't have access to your bank account. To check your balance, log in to your bank's online portal or check your account statement.";
    const declined = completionEnding({
      ...ABSTAINED,
      output: answer,
      abstention: { reason: "I don't have access to your bank account. To check your balance, log in to your bank's online portal or check your account statem" },
    });
    const segs = turnTranscript({ ...base, content: answer, ...declined });
    expect(segs.map((s) => s.kind)).toEqual(["answer", "ending"]);
    const shown = segs.find((s) => s.kind === "answer");
    const ending = segs.find((s) => s.kind === "ending");
    const outcome = ending?.kind === "ending" ? ending.outcome : undefined;
    const flag = outcome !== undefined && abstentionInAnswer(shown?.kind === "answer" ? shown.text : undefined, outcome);
    expect(flag).toBe(true);
    expect(endingNote(outcome!, { reasonInAnswer: flag })).toEqual({ kind: "abstained", tone: "quiet", icon: "ban", heading: "The agent declined; its reason is above", items: [] });
    // A reason the answer does not hold, or no answer, keeps the reason line.
    expect(abstentionInAnswer(answer, { ...outcome!, abstention: { reason: "The question needs live bank data." } })).toBe(false);
    expect(abstentionInAnswer(undefined, outcome!)).toBe(false);
    expect(abstentionInAnswer(answer, { ...outcome!, ending: "failed" })).toBe(false);
  });

  test("the header badge says abstained (quiet), and the summary outcome is abstained", () => {
    expect(endingBadge(ended.runFailed!)).toMatchObject({ label: "abstained", tone: "quiet" });
    expect(turnEnding(turn)).toBe("abstained");
  });
});

describe("the other endings", () => {
  test("failed: empty output, the cause in a red note, badge did not finish", () => {
    const ended = completionEnding({ output: "", success: false, terminatedBy: "llm_error", error: "400 credit balance too low" });
    expect(ended.runFailed).toEqual({ ending: "failed", terminatedBy: "llm_error", error: "400 credit balance too low" });
    const o = chatTurnOutcome({ content: "", ...ended })!;
    expect(endingNote(o)).toMatchObject({ kind: "failed", tone: "error", line: "400 credit balance too low" });
    expect(endingBadge(ended.runFailed!)).toMatchObject({ label: "did not finish", tone: "error" });
  });

  test("partial: the answer is the draft, the note lists the unfinished items", () => {
    const content = "Draft summary.\n\nUnfinished:\n- write the file ./report.md";
    const ended = completionEnding({ output: content, success: false, error: "Unfinished: write the file ./report.md" });
    const segs = turnTranscript({ ...base, content, ...ended });
    expect(segs[0]).toEqual({ kind: "answer", key: "answer", text: "Draft summary.", final: true });
    const ending = segs[1];
    expect(ending?.kind === "ending" && endingNote(ending.outcome)).toMatchObject({
      kind: "partial",
      tone: "warn",
      items: ["write the file ./report.md"],
    });
    expect(endingBadge(ended.runFailed!).label).toBe("partial");
  });

  test("success with empty output: the produced files are listed; no runFailed", () => {
    const ended = completionEnding({
      output: "",
      success: true,
      receipt: { deliverables: [{ spec: "produce the file ./report.md", produced: true }] },
    });
    expect(ended.runFailed).toBeUndefined();
    const segs = turnTranscript({ ...base, ...ended });
    const ending = segs.find((s) => s.kind === "ending");
    expect(ending?.kind === "ending" && endingNote(ending.outcome)).toMatchObject({
      kind: "files",
      items: ["produce the file ./report.md"],
    });
  });

  test("a plain success has no ending segment; a paused run sets no runFailed", () => {
    expect(turnTranscript({ ...base, content: "Paris." }).map((s) => s.kind)).toEqual(["answer"]);
    expect(completionEnding({ output: "", success: false, status: "awaiting-approval" }).runFailed).toBeUndefined();
  });

  test("a turn stored before ending kinds existed reads as failed", () => {
    const r = storedRunEnding({ terminatedBy: "max_iterations", error: "budget" });
    expect(turnEnding({ runFailed: r })).toBe("failed");
    expect(chatTurnOutcome({ content: "", runFailed: r })?.ending).toBe("failed");
  });
});

describe("runEnding (desk run view, AgentCompleted)", () => {
  const ev = (payload: Record<string, unknown>) => ({ type: "AgentCompleted", payload });
  test("abstained from outcome.status; succeeded and unfinished runs give undefined", () => {
    expect(runEnding([ev({ success: false, error: "declined", outcome: { status: "abstained" } })])?.ending).toBe("abstained");
    expect(runEnding([ev({ success: true })])).toBeUndefined();
    expect(runEnding([])).toBeUndefined();
  });
  test("partial from outcome.status with outstanding items", () => {
    expect(
      runEnding([ev({ success: false, output: "draft", outcome: { status: "partial", outstanding: ["write ./a.json"] } })]),
    ).toMatchObject({ ending: "partial", unfinished: ["write ./a.json"] });
  });
});

describe("bareEnding", () => {
  test("an incomplete turn with no recorded outcome gets a closing note", () => {
    expect(bareEnding({ incomplete: true })).toBe(true);
  });
  test("not while streaming, not for a user stop, not when an outcome exists, not for a finished turn", () => {
    expect(bareEnding({ incomplete: true, streaming: true })).toBe(false);
    expect(bareEnding({ incomplete: true, cancelled: true })).toBe(false);
    expect(bareEnding({ incomplete: true, runFailed: { ending: "failed" } })).toBe(false);
    expect(bareEnding({})).toBe(false);
  });
});
