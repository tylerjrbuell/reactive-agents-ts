import { describe, expect, test } from "bun:test";
import { Either } from "effect";
import {
  formatAnswerErrors,
  parseRequest,
  timeoutAnswer,
  validateAnswers,
  type AnswerError,
  type StructuredRequest,
} from "../src/skills/user-input-questions.js";

const req = (args: unknown): StructuredRequest => {
  const r = parseRequest(args);
  if (Either.isLeft(r)) throw new Error(r.left);
  return r.right;
};
const errs = (r: StructuredRequest, answers: unknown): readonly AnswerError[] => {
  const v = validateAnswers(r, answers);
  if (Either.isRight(v)) throw new Error("expected rejection");
  return v.left;
};

const threePart = {
  questions: [
    { id: "speed", prompt: "Shipping speed?", type: "single-choice", options: [{ label: "Std", value: "standard" }, { label: "Express", value: "express" }], allowOther: true },
    { id: "insure", prompt: "Insure it?", type: "boolean" },
    { id: "qty", prompt: "How many?", type: "number", min: 1, max: 10 },
  ],
};

describe("parseRequest", () => {
  test("legacy choice/confirmation/form/bare prompt normalize to questions", () => {
    expect(req({ kind: "choice", prompt: "p", schema: { options: ["a", "b"] } }).questions[0]).toMatchObject({ id: "answer", type: "single-choice" });
    expect(req({ kind: "confirmation", prompt: "ok?" }).questions[0]?.type).toBe("boolean");
    expect(req({ prompt: "name?" }).questions[0]?.type).toBe("text");
    const form = req({ kind: "form", prompt: "p", schema: { fields: [{ name: "age", label: "Age", type: "number", required: true }] } });
    expect(form.questions[0]).toMatchObject({ id: "age", type: "number", required: true });
  });
  test("rejects malformed structured requests", () => {
    expect(Either.isLeft(parseRequest({ questions: [{ id: "a", prompt: "x", type: "bogus" }] }))).toBe(true);
    expect(Either.isLeft(parseRequest({ questions: [{ id: "a", prompt: "x", type: "single-choice" }] }))).toBe(true);
    expect(Either.isLeft(parseRequest({ questions: [{ id: "a", prompt: "x", type: "text" }, { id: "a", prompt: "y", type: "text" }] }))).toBe(true);
    expect(Either.isLeft(parseRequest({ questions: [] }))).toBe(true);
  });
});

describe("validateAnswers", () => {
  test("legacy single question: typed answer map", () => {
    const r = req({ prompt: "name?" });
    expect(validateAnswers(r, { answer: "Ada" })).toEqual(Either.right({ status: "answered", answers: { answer: { status: "answered", value: "Ada" } } }));
  });
  test("3-part scripted tool call yields typed map", () => {
    // Arguments exactly as a model emits them (JSON text), answers as a host returns them.
    const emitted = JSON.parse(JSON.stringify({ prompt: "Book shipment", ...threePart }));
    const r = req(emitted);
    const v = validateAnswers(r, { speed: "express", insure: true, qty: 3 });
    expect(Either.isRight(v) && v.right).toEqual({
      status: "answered",
      answers: {
        speed: { status: "answered", value: "express" },
        insure: { status: "answered", value: true },
        qty: { status: "answered", value: 3 },
      },
    });
  });
  test("allowOther accepts free text and flags it", () => {
    const v = validateAnswers(req(threePart), { speed: "drone", insure: false, qty: 1 });
    expect(Either.isRight(v) && v.right.answers.speed).toEqual({ status: "answered", value: "drone", other: true });
  });
  test("rejects each failure class with a typed error", () => {
    const r = req({
      questions: [
        { id: "c", prompt: "c", type: "single-choice", options: [{ label: "A", value: "a" }] },
        { id: "m", prompt: "m", type: "multi-choice", options: [{ label: "A", value: "a" }, { label: "B", value: "b" }], min: 1, max: 1 },
        { id: "b", prompt: "b", type: "boolean" },
        { id: "n", prompt: "n", type: "number", min: 1, max: 5 },
        { id: "t", prompt: "t", type: "text", maxLength: 3 },
        { id: "req", prompt: "r", type: "text" },
      ],
    });
    const e = errs(r, { c: "zzz", m: ["a", "b"], b: "yes", n: 9, t: "toolong", ghost: 1 });
    expect(e.map((x) => x._tag).sort()).toEqual(
      ["NotInOptions", "OutOfRange", "OutOfRange", "RequiredMissing", "TooLong", "UnknownQuestion", "WrongType"].sort(),
    );
    expect(formatAnswerErrors(e)).toContain("'req' is required");
  });
  test("non-required skip carries default; all skipped -> skipped; mixed -> partial", () => {
    const r = req({ questions: [
      { id: "a", prompt: "a", type: "text", required: false, default: "dflt" },
      { id: "b", prompt: "b", type: "boolean", required: false },
    ] });
    const none = validateAnswers(r, {});
    expect(Either.isRight(none) && none.right).toEqual({ status: "skipped", answers: { a: { status: "skipped", value: "dflt" }, b: { status: "skipped" } } });
    const some = validateAnswers(r, { b: false });
    expect(Either.isRight(some) && some.right.status).toBe("partial");
  });
  test("timeoutAnswer marks every question", () => {
    const t = timeoutAnswer(req(threePart));
    expect(t.status).toBe("timeout");
    expect(Object.values(t.answers).every((a) => a.status === "timeout")).toBe(true);
  });
});
