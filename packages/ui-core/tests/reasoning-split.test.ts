import { describe, expect, it } from "bun:test";
import { buildTurnSteps, buildTurnTranscript, persistedTurnTranscriptOf, splitReasoning, turnTranscriptOf, foldTurnTrace, initialTurnTrace, type UiStreamEvent } from "../src/index.js";

describe("splitReasoning", () => {
  it("leaves ordinary answers untouched, including prose that merely starts with 'thought'", () => {
    expect(splitReasoning("The report is ready.")).toEqual({ reasoning: "", answer: "The report is ready.", leaked: false });
    expect(splitReasoning("thought is a fine thing").leaked).toBe(false);
  });

  it("splits reasoning the run reported on its own channel from the answer, however it is spaced", () => {
    const thinking = "The user wants a markdown report. I will list sections.";
    const text = `thought\nThe user wants a markdown report.\nI will list sections.\n\n# Report\nBody`;
    const s = splitReasoning(text, [thinking]);
    expect(s.leaked).toBe(true);
    expect(s.reasoning).toContain("The user wants a markdown report.");
    expect(s.answer).toBe("# Report\nBody");
  });

  it("while the reasoning is still arriving, all of it is reasoning and the answer is empty", () => {
    const s = splitReasoning("thought The user wants a mark", ["The user wants a markdown report."]);
    expect(s).toMatchObject({ answer: "", leaked: true });
    expect(s.reasoning).toBe("The user wants a mark");
  });

  it("an unconfirmed marker is dropped on its own line or before a capitalised word, nothing else is guessed", () => {
    expect(splitReasoning("thought\nThe user wants X").answer).toBe("The user wants X");
    expect(splitReasoning("thought The user wants X").answer).toBe("The user wants X");
    expect(splitReasoning("thought The user wants X").leaked).toBe(true);
  });
});

describe("splitReasoning: unconfirmed marker (no reported channel)", () => {
  const leak =
    "thought The user wants a markdown report on crypto. I will outline sections and fill each.\nHere's the plan:\n1. Overview\n2. Risks\n\n# Crypto Report\n\nBody text.";

  it("moves the leading reasoning block to reasoning and starts the answer at the plan list", () => {
    const s = splitReasoning(leak);
    expect(s.leaked).toBe(true);
    expect(s.reasoning).toBe("The user wants a markdown report on crypto. I will outline sections and fill each.");
    expect(s.answer.startsWith("Here's the plan:\n1. Overview")).toBe(true);
    expect(s.answer).toContain("# Crypto Report");
  });

  it("splits at the first blank line when prose follows prose", () => {
    const s = splitReasoning("thought\nI'll answer briefly and cite nothing.\n\nParis is the capital of France.");
    expect(s.reasoning).toBe("I'll answer briefly and cite nothing.");
    expect(s.answer).toBe("Paris is the capital of France.");
  });

  it("while streaming with no boundary yet, everything after the marker is reasoning", () => {
    const s = splitReasoning("thought The user wants a report and I should", [], { live: true });
    expect(s).toMatchObject({ answer: "", leaked: true });
    expect(s.reasoning).toBe("The user wants a report and I should");
  });

  it("final text with no boundary keeps the prose as the answer (never empties it)", () => {
    const s = splitReasoning("thought The user wants a short reply, so here it is.");
    expect(s.answer).toBe("The user wants a short reply, so here it is.");
    expect(s.reasoning).toBe("");
  });

  it("a block that does not read as reasoning is never swallowed", () => {
    const s = splitReasoning("thought Paris is the capital.\n\nIt sits on the Seine.");
    expect(s.reasoning).toBe("");
    expect(s.answer).toBe("Paris is the capital.\n\nIt sits on the Seine.");
  });

  it("an answer that merely begins with the word thought is untouched", () => {
    for (const t of ["thought leadership is a niche.\n\nMore.", "Thought experiments help.", "thoughtful replies matter"]) {
      expect(splitReasoning(t)).toEqual({ reasoning: "", answer: t, leaked: false });
    }
  });
});

describe("transcript thinking segment", () => {
  it("leads the transcript with provider thinking, live while streaming", () => {
    const events: UiStreamEvent[] = [
      { _tag: "IterationProgress", iteration: 1, maxIterations: 5 } as UiStreamEvent,
      { _tag: "ThinkingEmitted", content: "Weigh the options", iteration: 1 },
    ];
    const s = events.reduce(foldTurnTrace, initialTurnTrace());
    const seg = turnTranscriptOf(s)[0];
    expect(seg).toMatchObject({ kind: "thinking", text: "Weigh the options", live: true });
  });

  it("a leaked 'thought' preface never opens the answer: it moves to the thinking segment", () => {
    const steps = buildTurnSteps({ iterations: [{ iteration: 1, thinking: "The user wants a markdown report." }], calls: [] });
    const segs = buildTurnTranscript(steps, { answer: "thought The user wants a markdown report.\n\n# Report" });
    const answer = segs.find((s) => s.kind === "answer");
    expect(answer && "text" in answer ? answer.text : "").toBe("# Report");
    expect(segs[0]).toMatchObject({ kind: "thinking", live: false });
  });

  const leaked = "thought The user wants a report. I will outline it.\nHere's the plan:\n1. Overview\n2. Risks";

  it("a leaked preface with no reported channel renders answer-only plus a thinking pill, also after reload", () => {
    const steps = buildTurnSteps({ iterations: [], calls: [] });
    const segs = buildTurnTranscript(steps, { answer: leaked });
    expect(segs[0]).toMatchObject({ kind: "thinking", live: false, text: "The user wants a report. I will outline it." });
    const answer = segs.find((s) => s.kind === "answer");
    expect(answer && "text" in answer ? answer.text : "").toBe("Here's the plan:\n1. Overview\n2. Risks");
    // Reload: the stored row carries only the raw content, so the same builder replays the pill.
    const reloaded = persistedTurnTranscriptOf({ reasoningSteps: [], toolCalls: [] }, leaked);
    expect(reloaded[0]).toMatchObject({ kind: "thinking", text: "The user wants a report. I will outline it." });
  });

  it("a streaming leaked preface is all pill until its answer starts", () => {
    const steps = buildTurnSteps({ iterations: [], calls: [] });
    const early = buildTurnTranscript(steps, { pending: "thought The user wants a rep", live: true });
    expect(early[0]).toMatchObject({ kind: "thinking", live: true, text: "The user wants a rep" });
    expect(early.some((s) => s.kind === "answer")).toBe(false);
  });

  it("an answer that begins with 'thought' is shown untouched with no pill", () => {
    const segs = buildTurnTranscript(buildTurnSteps({ iterations: [], calls: [] }), { answer: "thought leadership is a niche." });
    expect(segs.some((s) => s.kind === "thinking")).toBe(false);
    expect(segs.find((s) => s.kind === "answer")).toMatchObject({ text: "thought leadership is a niche." });
  });

  it("a turn with no reasoning has no thinking segment", () => {
    const segs = buildTurnTranscript(buildTurnSteps({ iterations: [], calls: [] }), { answer: "Hi" });
    expect(segs.some((s) => s.kind === "thinking")).toBe(false);
  });
});
