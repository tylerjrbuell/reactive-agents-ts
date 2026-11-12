import { describe, expect, it } from "bun:test";
import { buildAnswers, optionLabel, otherKey, questionsOf, type StructuredQuestion } from "./structured-questions.js";

const Q: StructuredQuestion[] = [
  { id: "env", prompt: "Where?", type: "single-choice", options: [{ label: "Staging", value: "stg" }, { label: "Production", value: "prod" }] },
  { id: "tags", prompt: "Which checks?", type: "multi-choice", min: 1, max: 2, options: [{ label: "Lint", value: "lint" }, { label: "Tests", value: "test" }, { label: "Types", value: "types" }] },
  { id: "go", prompt: "Proceed?", type: "boolean" },
  { id: "n", prompt: "How many?", type: "number", min: 1, max: 10 },
  { id: "note", prompt: "Note", type: "text", required: false, maxLength: 5 },
];

describe("questionsOf", () => {
  it("reads questions from the wire field, else from the persisted schema, else none", () => {
    expect(questionsOf({ questions: Q }).map((q) => q.id)).toEqual(["env", "tags", "go", "n", "note"]);
    expect(questionsOf({ schema: { questions: [Q[2]] } }).map((q) => q.id)).toEqual(["go"]);
    expect(questionsOf({ schema: { options: ["a"] } })).toEqual([]);
    expect(questionsOf({})).toEqual([]);
  });

  it("drops malformed entries and choice questions with nothing to pick", () => {
    const got = questionsOf({
      questions: [
        { id: "ok", prompt: "p", type: "text" },
        { id: "", prompt: "p", type: "text" },
        { id: "bad", prompt: "p", type: "color" },
        { id: "empty", prompt: "p", type: "single-choice", options: [] },
        { id: "free", prompt: "p", type: "single-choice", allowOther: true },
        "nope",
      ],
    });
    expect(got.map((q) => q.id)).toEqual(["ok", "free"]);
  });

  it("falls back to the value as an option label", () => {
    const [q] = questionsOf({ questions: [{ id: "a", prompt: "p", type: "single-choice", options: [{ value: "x" }] }] });
    expect(q?.options?.[0]?.label).toBe("x");
    expect(optionLabel(Q[0] as StructuredQuestion, "stg")).toBe("Staging");
    expect(optionLabel(Q[0] as StructuredQuestion, "elsewhere")).toBe("elsewhere");
  });
});

describe("buildAnswers", () => {
  it("builds the id-keyed map with typed values; a blank optional question is left out", () => {
    const out = buildAnswers(Q, { env: "prod", tags: ["lint", "test"], go: "yes", n: " 3 ", note: "" });
    expect(out).toEqual({ ok: true, answers: { env: "prod", tags: ["lint", "test"], go: true, n: 3 } });
    const no = buildAnswers(Q.slice(2, 3), { go: "no" });
    expect(no).toEqual({ ok: true, answers: { go: false } });
  });

  it("names every problem by question id", () => {
    const out = buildAnswers(Q, { env: "mars", tags: ["lint", "test", "types"], n: "99", note: "too long" });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.errors).toEqual({
      env: "Pick one of the options.",
      tags: "Pick at most 2.",
      go: "Answer this question.",
      n: "At most 10.",
      note: "At most 5 characters.",
    });
  });

  it("rejects a non-number and a missing required answer", () => {
    const out = buildAnswers(Q.slice(3, 4), { n: "abc" });
    expect(out).toEqual({ ok: false, errors: { n: "Enter a number." } });
    expect(buildAnswers(Q.slice(3, 4), {})).toEqual({ ok: false, errors: { n: "Answer this question." } });
  });

  it("accepts a free-text value outside the options only when allowOther", () => {
    const open: StructuredQuestion = { ...(Q[0] as StructuredQuestion), allowOther: true };
    expect(buildAnswers([open], { env: "stg", [otherKey("env")]: "dev box" })).toEqual({ ok: true, answers: { env: "dev box" } });
    expect(buildAnswers([Q[0] as StructuredQuestion], { env: "stg", [otherKey("env")]: "dev box" })).toEqual({ ok: true, answers: { env: "stg" } });
    const multi: StructuredQuestion = { id: "tags", prompt: "Which?", type: "multi-choice", allowOther: true, options: [{ label: "Lint", value: "lint" }] };
    expect(buildAnswers([multi], { tags: ["lint"], [otherKey("tags")]: "perf" })).toEqual({ ok: true, answers: { tags: ["lint", "perf"] } });
  });
});
