import { describe, expect, test } from "bun:test";
import { mentionTrigger, removeMention } from "./mention-trigger.js";

describe("mentionTrigger", () => {
  test("an @ at the start or after whitespace opens the picker with the typed query", () => {
    expect(mentionTrigger("@", 1)).toEqual({ start: 0, end: 1, query: "" });
    expect(mentionTrigger("look at @src/ch", 15)).toEqual({ start: 8, end: 15, query: "src/ch" });
    expect(mentionTrigger("(@read", 6)).toEqual({ start: 1, end: 6, query: "read" });
  });

  test("an email or mid-word @ is not a trigger", () => {
    expect(mentionTrigger("mail me a@b.com", 15)).toBeNull();
    expect(mentionTrigger("foo@bar", 7)).toBeNull();
  });

  test("the caret decides: text after it, a space before it, or no @ closes the picker", () => {
    expect(mentionTrigger("look @read now", 10)).toEqual({ start: 5, end: 10, query: "read" });
    expect(mentionTrigger("look @read now", 14)).toBeNull();
    expect(mentionTrigger("look @read ", 11)).toBeNull();
    expect(mentionTrigger("no mention", 5)).toBeNull();
  });

  test("a second @ in the word or an over-long query is not a trigger", () => {
    expect(mentionTrigger("@a@b", 4)).toBeNull();
    expect(mentionTrigger(`@${"x".repeat(200)}`, 201)).toBeNull();
  });
});

describe("removeMention", () => {
  test("takes out only the typed @query, keeping the rest of the draft", () => {
    const text = "review @src/ch please";
    const t = mentionTrigger(text, 14)!;
    expect(removeMention(text, t)).toEqual({ text: "review please", caret: 7 });
  });

  test("at the end of the draft", () => {
    const t = mentionTrigger("compare with @", 14)!;
    expect(removeMention("compare with @", t)).toEqual({ text: "compare with ", caret: 13 });
  });
});
