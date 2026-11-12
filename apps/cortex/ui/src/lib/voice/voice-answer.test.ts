import { describe, expect, test } from "bun:test";
import { confirmIntent, matchSpokenAnswer, parseSpokenNumber, voiceQuestionSpec, wordsToInteger, type VoiceAnswerMatch, type VoiceQuestionSpec } from "./voice-answer.js";

const ENVS: VoiceQuestionSpec = { kind: "choice", options: ["Staging", "Production", "Production EU", "Local"] };
const COLORS: VoiceQuestionSpec = { kind: "choice", options: ["Red", "Green", "Blue"] };
const TOPPINGS: VoiceQuestionSpec = { kind: "choice", options: ["Cheese", "Ham", "Olives", "Onion"], multi: true };

type Row = readonly [label: string, spec: VoiceQuestionSpec, said: string, expected: { value: unknown; confirmed?: boolean } | "none" | { ambiguous: string[] }];

const ROWS: readonly Row[] = [
  // choice: labels
  ["exact label", COLORS, "green", { value: "Green" }],
  ["label with filler", COLORS, "I would pick blue please", { value: "Blue" }],
  ["label inside a sentence", ENVS, "let's go with staging", { value: "Staging" }],
  ["longest label wins over its prefix label", ENVS, "production eu", { value: "Production EU" }],
  ["exact label wins over prefix", ENVS, "production", { value: "Production" }],
  ["unique prefix", COLORS, "gre", { value: "Green" }],
  ["shared prefix is ambiguous", { kind: "choice", options: ["Production", "Prod EU"] }, "prod", { ambiguous: ["Production", "Prod EU"] }],
  // choice: ordinals, letters, numbers
  ["ordinal: the second one", COLORS, "the second one", { value: "Green" }],
  ["ordinal: first", COLORS, "first", { value: "Red" }],
  ["ordinal: third", COLORS, "the third", { value: "Blue" }],
  ["ordinal: last", COLORS, "the last one", { value: "Blue" }],
  ["letter: option B", COLORS, "option B", { value: "Green" }],
  ["letter alone", COLORS, "c", { value: "Blue" }],
  ["number word", COLORS, "number two", { value: "Green" }],
  ["digit", COLORS, "3", { value: "Blue" }],
  ["ordinal past the end", COLORS, "the fifth one", "none"],
  ["letter past the end", COLORS, "option f", "none"],
  ["negation is not a pick", COLORS, "not red", "none"],
  ["unknown words", COLORS, "purple", "none"],
  ["empty", COLORS, "   ", "none"],
  // choice: explicit confirm phrase
  ["label + send it", COLORS, "green, send it", { value: "Green", confirmed: true }],
  ["ordinal + confirm", COLORS, "the second one confirm", { value: "Green", confirmed: true }],
  ["only a confirm phrase", COLORS, "send it", "none"],
  // multi choice
  ["multi: two labels", TOPPINGS, "cheese and olives", { value: ["Cheese", "Olives"] }],
  ["multi: ordinals", TOPPINGS, "first and third", { value: ["Cheese", "Olives"] }],
  ["multi: comma list, out of order", TOPPINGS, "onion, cheese", { value: ["Cheese", "Onion"] }],
  ["multi: one pick stays a list", TOPPINGS, "ham", { value: ["Ham"] }],
  ["multi: all of them", TOPPINGS, "all of them", { value: ["Cheese", "Ham", "Olives", "Onion"] }],
  ["multi: one unknown part voids it", TOPPINGS, "cheese and pineapple", "none"],
  // boolean
  ["yes", { kind: "boolean" }, "yes", { value: true }],
  ["yeah sure", { kind: "boolean" }, "yeah sure", { value: true }],
  ["true", { kind: "boolean" }, "true", { value: true }],
  ["go ahead", { kind: "boolean" }, "go ahead", { value: true }],
  ["no", { kind: "boolean" }, "no", { value: false }],
  ["nope", { kind: "boolean" }, "Nope.", { value: false }],
  ["don't", { kind: "boolean" }, "don't", { value: false }],
  ["absolutely not", { kind: "boolean" }, "absolutely not", { value: false }],
  ["yes and no together", { kind: "boolean" }, "yes no", { ambiguous: ["yes", "no"] }],
  ["unrelated", { kind: "boolean" }, "maybe tomorrow", "none"],
  ["yes + send it", { kind: "boolean" }, "yes, send it", { value: true, confirmed: true }],
  ["no + confirm", { kind: "boolean" }, "no confirm", { value: false, confirmed: true }],
  // number
  ["digits", { kind: "number" }, "42", { value: 42 }],
  ["decimal digits", { kind: "number" }, "3.5", { value: 3.5 }],
  ["thousands separator", { kind: "number" }, "1,000", { value: 1000 }],
  ["negative digits", { kind: "number" }, "-4", { value: -4 }],
  ["words", { kind: "number" }, "forty two", { value: 42 }],
  ["words with hundred and and", { kind: "number" }, "one hundred and five", { value: 105 }],
  ["a hundred", { kind: "number" }, "a hundred", { value: 100 }],
  ["thousand", { kind: "number" }, "two thousand twenty", { value: 2020 }],
  ["minus words", { kind: "number" }, "minus three", { value: -3 }],
  ["decimal words", { kind: "number" }, "three point five", { value: 3.5 }],
  ["number below min", { kind: "number", min: 1 }, "0", "none"],
  ["number above max", { kind: "number", max: 10 }, "eleven", "none"],
  ["number in range + send it", { kind: "number", min: 1, max: 10 }, "seven send it", { value: 7, confirmed: true }],
  ["not a number", { kind: "number" }, "a few", "none"],
  // text
  ["free text keeps the words", { kind: "text" }, "Use the blue one, thanks", { value: "Use the blue one, thanks" }],
  ["free text + send it", { kind: "text" }, "Use the blue one. Send it.", { value: "Use the blue one", confirmed: true }],
  ["free text empty", { kind: "text" }, "", "none"],
  ["free text only a confirm phrase", { kind: "text" }, "send it", "none"],
];

describe("matchSpokenAnswer table", () => {
  for (const [label, spec, said, expected] of ROWS) {
    test(`${label}: "${said}"`, () => {
      const got: VoiceAnswerMatch = matchSpokenAnswer(said, spec);
      if (expected === "none") {
        expect(got.type).toBe("none");
      } else if ("ambiguous" in expected) {
        expect(got.type).toBe("ambiguous");
        if (got.type === "ambiguous") expect([...got.candidates].sort()).toEqual([...expected.ambiguous].sort());
      } else {
        expect(got.type).toBe("answer");
        if (got.type === "answer") {
          expect(got.value).toEqual(expected.value as never);
          expect(got.confirmed).toBe(expected.confirmed === true);
        }
      }
    });
  }
});

describe("number words", () => {
  test("wordsToInteger", () => {
    expect(wordsToInteger(["twenty", "one"])).toBe(21);
    expect(wordsToInteger(["nine", "hundred", "ninety", "nine"])).toBe(999);
    expect(wordsToInteger(["banana"])).toBeNull();
    expect(wordsToInteger([])).toBeNull();
  });
  test("parseSpokenNumber", () => {
    expect(parseSpokenNumber("the number seven")).toBe(7);
    expect(parseSpokenNumber("zero point zero five")).toBe(0.05);
    expect(parseSpokenNumber("twelve apples")).toBeNull();
  });
});

describe("confirmIntent", () => {
  test.each([
    ["yes", "confirm"],
    ["Send it", "confirm"],
    ["that's right", "confirm"],
    ["confirm", "confirm"],
    ["no", "reject"],
    ["change it", "reject"],
    ["try again", "reject"],
    ["the second one", "unknown"],
    ["production", "unknown"],
  ] as const)("%s is %s", (said, intent) => {
    expect(confirmIntent(said)).toBe(intent);
  });
});

describe("voiceQuestionSpec", () => {
  test("maps today's wire shapes", () => {
    expect(voiceQuestionSpec({ kind: "confirmation", schema: undefined })).toEqual({ kind: "boolean" });
    expect(voiceQuestionSpec({ kind: "choice", schema: { options: ["A", "B"] } })).toEqual({ kind: "choice", options: ["A", "B"] });
  });
  test("a choice with no options, a form and unknown kinds are free text", () => {
    expect(voiceQuestionSpec({ kind: "choice", schema: {} })).toEqual({ kind: "text" });
    expect(voiceQuestionSpec({ kind: "form", schema: { fields: [{ name: "a" }] } })).toEqual({ kind: "text" });
    expect(voiceQuestionSpec({ kind: "text", schema: null })).toEqual({ kind: "text" });
  });
});
