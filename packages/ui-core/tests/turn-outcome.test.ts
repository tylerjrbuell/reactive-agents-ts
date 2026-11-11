import { describe, expect, test } from "bun:test";
import {
  buildTurnTranscript,
  finishTurnTrace,
  foldTurnTrace,
  initialRunState,
  initialTurnTrace,
  persistedTurnTranscriptOf,
  reduceRunState,
  splitUnfinished,
  summarizeTurn,
  turnOutcomeOf,
  turnStepsOf,
  turnTranscriptOf,
  type UiStreamEvent,
} from "../src/index.js";

const meta = { duration: 1, cost: 0, tokensUsed: 1, stepsCount: 1 };
const done = (fields: Record<string, unknown>): UiStreamEvent =>
  ({ _tag: "StreamCompleted", output: "", metadata: meta, ...fields }) as UiStreamEvent;
const ATTEMPTED = "What was attempted: 2 tool call(s) attempted (web-search), 1 succeeded.";

describe("turnOutcomeOf: the four endings from the framework's result fields", () => {
  test("success: the answer is output; receipt deliverables ride along", () => {
    expect(turnOutcomeOf({ success: true, output: "Paris." })).toEqual({ ending: "succeeded" });
    const files = turnOutcomeOf({
      success: true,
      output: "",
      receipt: { deliverables: [{ spec: "produce the file ./report.md", produced: true }, { bad: 1 }] },
    });
    expect(files).toEqual({ ending: "succeeded", deliverables: [{ spec: "produce the file ./report.md", produced: true }] });
  });

  test("failed: empty output, the cause on error", () => {
    const o = turnOutcomeOf({ success: false, output: "", error: `budget exhausted. ${ATTEMPTED}`, terminatedBy: "max_iterations" });
    expect(o).toEqual({ ending: "failed", error: `budget exhausted. ${ATTEMPTED}`, terminatedBy: "max_iterations" });
  });

  test("failed: the model's own last text kept as output is still failed (no Unfinished list)", () => {
    expect(turnOutcomeOf({ success: false, output: "I tried.", error: "llm_error" }).ending).toBe("failed");
  });

  test("abstained: terminatedBy abstained + abstention object; not a failure", () => {
    const o = turnOutcomeOf({
      success: false,
      output: "",
      terminatedBy: "abstained",
      error: "The agent abstained: no grounded answer.",
      abstention: { reason: "no grounded answer", missing: ["web-search"] },
    });
    expect(o.ending).toBe("abstained");
    expect(o.abstention).toEqual({ reason: "no grounded answer", missing: ["web-search"] });
  });

  test("abstained without an abstention object: the reason falls back to error", () => {
    const o = turnOutcomeOf({ success: false, terminatedBy: "abstained", error: "required tool missing" });
    expect(o).toMatchObject({ ending: "abstained", abstention: { reason: "required tool missing" } });
  });

  test("abstained from an AgentCompleted payload (outcome.status)", () => {
    expect(turnOutcomeOf({ success: false, error: "declined", outcome: { status: "abstained" } }).ending).toBe("abstained");
  });

  test("partial: draft + Unfinished list split apart", () => {
    const output = "Here is the summary so far.\n\nUnfinished:\n- write the file ./report.md\n- call the `x` tool";
    const o = turnOutcomeOf({ success: false, output, error: "Unfinished: write the file ./report.md" });
    expect(o.ending).toBe("partial");
    expect(o.draft).toBe("Here is the summary so far.");
    expect(o.unfinished).toEqual(["write the file ./report.md", "call the `x` tool"]);
  });

  test("partial from AgentCompleted.outcome.status with outstanding ids", () => {
    const o = turnOutcomeOf({ success: false, output: "draft", outcome: { status: "partial", outstanding: ["write ./a.json"] } });
    expect(o).toMatchObject({ ending: "partial", draft: "draft", unfinished: ["write ./a.json"] });
  });

  test("paused: an awaiting status or a pending gate", () => {
    expect(turnOutcomeOf({ success: false, status: "awaiting-approval" }).ending).toBe("paused");
    expect(turnOutcomeOf({ success: false, pendingInteraction: { runId: "r" } }).ending).toBe("paused");
  });

  test("splitUnfinished: no list → undefined", () => {
    expect(splitUnfinished("just an answer")).toBeUndefined();
    expect(splitUnfinished("Unfinished:\n- a")).toEqual({ draft: "", unfinished: ["a"] });
  });
});

describe("turn fold, transcript and summary carry the ending", () => {
  const fold = (events: UiStreamEvent[]) => events.reduce(foldTurnTrace, initialTurnTrace());

  test("abstained turn: ended + outcome, an ending segment, summary says abstained", () => {
    const s = fold([
      { _tag: "IterationProgress", iteration: 1, maxIterations: 5, status: "r" },
      done({ success: false, terminatedBy: "abstained", error: "no grounded answer", abstention: { reason: "no grounded answer" } }),
    ]);
    expect(s.ended).toBe("abstained");
    const segs = turnTranscriptOf(s);
    expect(segs.map((x) => x.kind)).toEqual(["ending"]);
    const ending = segs[0];
    expect(ending?.kind === "ending" && ending.outcome.abstention?.reason).toBe("no grounded answer");
    expect(summarizeTurn(turnStepsOf(s), { ended: s.ended }).line).toContain("abstained");
  });

  test("partial turn: the answer is the draft, the ending lists the unfinished items", () => {
    const s = fold([done({ success: false, output: "Draft.\n\nUnfinished:\n- write ./r.md", error: "Unfinished: write ./r.md" })]);
    const segs = turnTranscriptOf(s);
    expect(segs).toEqual([
      { kind: "answer", key: "answer", text: "Draft.", final: true },
      { kind: "ending", key: "ending", outcome: expect.objectContaining({ ending: "partial", unfinished: ["write ./r.md"] }) },
    ]);
  });

  test("failed turn persists its outcome even with no steps; a plain success persists nothing new", () => {
    const failed = finishTurnTrace(fold([done({ success: false, error: "400 credit balance too low", terminatedBy: "llm_error" })]));
    expect(failed?.outcome).toEqual({ ending: "failed", error: "400 credit balance too low", terminatedBy: "llm_error" });
    expect(persistedTurnTranscriptOf(failed!, "").map((x) => x.kind)).toEqual(["ending"]);
    // A plain success keeps no outcome; only the reported duration persists.
    expect(finishTurnTrace(fold([done({ output: "ok" })]))).toEqual({ reasoningSteps: [], toolCalls: [], durationMs: 1 });
  });

  test("success with empty output: the produced files are the ending; with an answer, no ending segment", () => {
    const outcome = turnOutcomeOf({ success: true, receipt: { deliverables: [{ spec: "./r.md", produced: true }] } });
    expect(buildTurnTranscript([], { answer: "", outcome }).map((x) => x.kind)).toEqual(["ending"]);
    expect(buildTurnTranscript([], { answer: "Wrote it.", outcome }).map((x) => x.kind)).toEqual(["answer"]);
  });
});

describe("run machine exposes the ending", () => {
  test("a failed completion carries error + outcome (status alone is not success)", () => {
    const s = reduceRunState(initialRunState(), {
      _tag: "StreamCompleted",
      output: "",
      metadata: {},
      success: false,
      error: "Strategy execution failed (reactive): llm_error",
      seq: 1,
    });
    expect(s.status).toBe("completed");
    expect(s.error).toBe("Strategy execution failed (reactive): llm_error");
    expect(s.outcome?.ending).toBe("failed");
  });
});
