import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  decodeSystemOneAnswers,
  encodeSystemOneRequest,
} from "../src/backends/systemone/wire.js";
import {
  JudgmentBadResponse,
  type ChoiceSpec,
  type NoulSpec,
  type QuestionSpecs,
  type ScoreSpec,
} from "../src/types.js";

describe("encodeSystemOneRequest", () => {
  test("state: non-blank string, object, and array pass through unchanged", () => {
    const question: NoulSpec = { type: "noul" };

    expect(
      encodeSystemOneRequest({ model: "m", state: "hello", questions: { q: question } }),
    ).toEqual({
      model: "m",
      state: "hello",
      questions: { q: { type: "noul", instructions: {}, criteria: {} } },
    });

    expect(
      encodeSystemOneRequest({ model: "m", state: { a: 1 }, questions: { q: question } }),
    ).toEqual({
      model: "m",
      state: { a: 1 },
      questions: { q: { type: "noul", instructions: {}, criteria: {} } },
    });

    expect(
      encodeSystemOneRequest({ model: "m", state: [1, 2], questions: { q: question } }),
    ).toEqual({
      model: "m",
      state: [1, 2],
      questions: { q: { type: "noul", instructions: {}, criteria: {} } },
    });
  });

  test("state: null, undefined, empty string, and whitespace-only all encode to {}", () => {
    const question: NoulSpec = { type: "noul" };

    for (const state of [null, undefined, "", "   ", "\t\n"]) {
      expect(
        encodeSystemOneRequest({ model: "m", state, questions: { q: question } }),
      ).toEqual({
        model: "m",
        state: {},
        questions: { q: { type: "noul", instructions: {}, criteria: {} } },
      });
    }
  });

  test("instructions: omitted, null, and blank all encode to {} on every question type", () => {
    const noul: NoulSpec = { type: "noul" };
    const choice: ChoiceSpec = {
      type: "choice",
      instructions: null,
      criteria: { a: null },
    };
    const score: ScoreSpec = {
      type: "score",
      instructions: "   ",
      criteria: ["low", "high"],
    };

    expect(encodeSystemOneRequest({ model: "m", state: null, questions: { noul, choice, score } })).toEqual({
      model: "m",
      state: {},
      questions: {
        noul: { type: "noul", instructions: {}, criteria: {} },
        choice: { type: "choice", instructions: {}, criteria: { a: null } },
        score: { type: "score", instructions: {}, criteria: ["low", "high"] },
      },
    });
  });

  test("instructions: a real string passes through verbatim", () => {
    const noul: NoulSpec = { type: "noul", instructions: "Is this billing?" };

    expect(encodeSystemOneRequest({ model: "m", state: null, questions: { noul } })).toEqual({
      model: "m",
      state: {},
      questions: {
        noul: { type: "noul", instructions: "Is this billing?", criteria: {} },
      },
    });
  });

  test("choice.criteria: string verbatim, null verbatim, object and array JSON.stringify-ed", () => {
    const choice: ChoiceSpec = {
      type: "choice",
      criteria: {
        a: "string",
        b: null,
        c: { x: 1 },
        d: [1, 2],
      },
    };

    expect(encodeSystemOneRequest({ model: "m", state: null, questions: { choice } })).toEqual({
      model: "m",
      state: {},
      questions: {
        choice: {
          type: "choice",
          instructions: {},
          criteria: {
            a: "string",
            b: null,
            c: JSON.stringify({ x: 1 }),
            d: JSON.stringify([1, 2]),
          },
        },
      },
    });
  });

  test("score.criteria: string verbatim, null becomes '', object and array JSON.stringify-ed", () => {
    const score: ScoreSpec = {
      type: "score",
      criteria: ["string", null, { x: 1 }, [1, 2]],
    };

    expect(encodeSystemOneRequest({ model: "m", state: null, questions: { score } })).toEqual({
      model: "m",
      state: {},
      questions: {
        score: {
          type: "score",
          instructions: {},
          criteria: ["string", "", JSON.stringify({ x: 1 }), JSON.stringify([1, 2])],
        },
      },
    });
  });

  test("noul.criteria: string verbatim, non-string JSON.stringify-ed, null/undefined side omitted", () => {
    const noul: NoulSpec = {
      type: "noul",
      criteria: {
        true: "Yes",
        false: { x: 1 },
      },
    };

    expect(encodeSystemOneRequest({ model: "m", state: null, questions: { noul } })).toEqual({
      model: "m",
      state: {},
      questions: {
        noul: {
          type: "noul",
          instructions: {},
          criteria: {
            true: "Yes",
            false: JSON.stringify({ x: 1 }),
          },
        },
      },
    });

    const omitted: NoulSpec = {
      type: "noul",
      criteria: {
        true: undefined,
        false: null,
      },
    };

    expect(encodeSystemOneRequest({ model: "m", state: null, questions: { omitted } })).toEqual({
      model: "m",
      state: {},
      questions: {
        omitted: {
          type: "noul",
          instructions: {},
          criteria: {},
        },
      },
    });
  });

  test("questions keys and choice labels pass through verbatim", () => {
    const choice: ChoiceSpec = {
      type: "choice",
      criteria: { "": null, "with space": "desc" },
    };

    expect(encodeSystemOneRequest({ model: "m", state: null, questions: { "q-id": choice } })).toEqual({
      model: "m",
      state: {},
      questions: {
        "q-id": {
          type: "choice",
          instructions: {},
          criteria: { "": null, "with space": "desc" },
        },
      },
    });
  });

  test("images omitted from the body when absent or empty; present verbatim and in order otherwise", () => {
    const noul: NoulSpec = { type: "noul" };

    expect(
      encodeSystemOneRequest({ model: "m", state: null, questions: { noul } }),
    ).not.toHaveProperty("images");

    expect(
      encodeSystemOneRequest({ model: "m", state: null, questions: { noul }, images: [] }),
    ).not.toHaveProperty("images");

    expect(
      encodeSystemOneRequest({ model: "m", state: null, questions: { noul }, images: ["a", "b"] }),
    ).toEqual({
      model: "m",
      state: {},
      questions: { noul: { type: "noul", instructions: {}, criteria: {} } },
      images: ["a", "b"],
    });
  });

  test("a nested structured state round-trips into the exact { model, state, questions } body", () => {
    const state = { nested: { list: [1, { key: "val" }] }, flag: true };
    const choice: ChoiceSpec = {
      type: "choice",
      instructions: "Pick",
      criteria: { a: "A" },
    };

    expect(encodeSystemOneRequest({ model: "nimble", state, questions: { q: choice } })).toEqual({
      model: "nimble",
      state,
      questions: {
        q: {
          type: "choice",
          instructions: "Pick",
          criteria: { a: "A" },
        },
      },
    });
  });
});

describe("decodeSystemOneAnswers", () => {
  const specs: QuestionSpecs = {
    c: { type: "choice", instructions: "Pick", criteria: { a: null, b: null } },
    s: { type: "score", instructions: "Rate", criteria: ["low", "mid", "high"] },
    n: { type: "noul", instructions: "Yes?" },
  };

  test("decodes all three kinds with calibrated:true and probabilities verbatim", async () => {
    const raw = {
      model: "nimble",
      usage: { input_tokens: 10 },
      answers: {
        c: { type: "choice", choice: "a", probabilities: { a: 0.7, b: 0.3 }, confidence: 0.7 },
        s: { type: "score", score: 1.8, probabilities: { "0": 0.1, "1": 0.2, "2": 0.7 }, confidence: 0.75 },
        n: { type: "noul", noul: 0.87 },
      },
    };

    const answers = await Effect.runPromise(decodeSystemOneAnswers(raw, specs));

    expect(answers.c).toEqual({
      kind: "choice",
      value: "a",
      probabilities: { a: 0.7, b: 0.3 },
      confidence: 0.7,
      calibrated: true,
    });
    expect(answers.s).toEqual({
      kind: "score",
      value: 1.8,
      probabilities: { "0": 0.1, "1": 0.2, "2": 0.7 },
      confidence: 0.75,
      calibrated: true,
    });
    expect(answers.n).toEqual({ kind: "noul", probability: 0.87 });
  });

  test("fails JudgmentBadResponse when a requested id is missing from answers", async () => {
    const raw = {
      answers: {
        c: { type: "choice", choice: "a", probabilities: { a: 1 }, confidence: 1 },
        s: { type: "score", score: 0, probabilities: { "0": 1 }, confidence: 1 },
      },
    };

    const error = await Effect.runPromise(Effect.flip(decodeSystemOneAnswers(raw, specs)));

    expect(error).toBeInstanceOf(JudgmentBadResponse);
    expect(error.message).toContain("n");
    expect(error.message).toMatch(/missing answer/i);
  });

  test("fails JudgmentBadResponse when the wire type does not match the requested spec type", async () => {
    const raw = {
      answers: {
        c: { type: "choice", choice: "a", probabilities: { a: 1 }, confidence: 1 },
        s: { type: "score", score: 0, probabilities: { "0": 1 }, confidence: 1 },
        n: { type: "choice", choice: "a", probabilities: { a: 1 }, confidence: 1 },
      },
    };

    const error = await Effect.runPromise(Effect.flip(decodeSystemOneAnswers(raw, specs)));

    expect(error).toBeInstanceOf(JudgmentBadResponse);
    expect(error.message).toContain("n");
    expect(error.message).toMatch(/type mismatch/i);
  });

  test("fails JudgmentBadResponse on an unknown wire type", async () => {
    const raw = {
      answers: {
        c: { type: "unknown", value: "x" },
      },
    };

    const error = await Effect.runPromise(
      Effect.flip(decodeSystemOneAnswers(raw, { c: specs.c })),
    );

    expect(error).toBeInstanceOf(JudgmentBadResponse);
  });

  test("tolerates excess response fields (model, usage)", async () => {
    const raw = {
      model: "ignored",
      usage: { total_tokens: 99 },
      extra: "ignored",
      answers: {
        n: { type: "noul", noul: 0.5 },
      },
    };

    const answers = await Effect.runPromise(decodeSystemOneAnswers(raw, { n: specs.n }));

    expect(answers.n).toEqual({ kind: "noul", probability: 0.5 });
  });
});
