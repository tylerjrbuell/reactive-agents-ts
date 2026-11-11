import { describe, expect, it } from "bun:test";
import {
  highlightPieces,
  inlineActivations,
  inlineTrigger,
  insertAtCaret,
  parseInlineCommands,
  promptWithoutCommands,
  removeSkillTokens,
  triggerIsComplete,
  type InlineCommand,
} from "./chat-inline-commands.js";

const SKILLS = ["codebase-health-sweep", "review", "Deep_Research2"];
const commands = (text: string): InlineCommand[] => parseInlineCommands(text, SKILLS).filter((s): s is InlineCommand => s.kind === "command");
const recognized = (text: string) => commands(text).filter((c) => c.recognized).map((c) => c.skill);
const prompt = (text: string) => promptWithoutCommands(parseInlineCommands(text, SKILLS));

describe("parseInlineCommands: positions", () => {
  it("recognizes a skill at the end, start and middle", () => {
    expect(recognized("summarize this repo /codebase-health-sweep")).toEqual(["codebase-health-sweep"]);
    expect(recognized("/review this diff")).toEqual(["review"]);
    expect(recognized("please /review the diff")).toEqual(["review"]);
  });
  it("recognizes several commands in one message, in order", () => {
    expect(recognized("/review then /codebase-health-sweep")).toEqual(["review", "codebase-health-sweep"]);
  });
  it("keeps segment offsets that cover the text exactly", () => {
    const text = "a /review b /nope c";
    const segs = parseInlineCommands(text, SKILLS);
    expect(segs.map((s) => s.text).join("")).toBe(text);
    for (const s of segs) expect(text.slice(s.start, s.end)).toBe(s.text);
  });
  it("matches skill names case-insensitively and returns the canonical name", () => {
    expect(recognized("go /deep_research2 now")).toEqual(["Deep_Research2"]);
  });
  it("recognizes after a newline and after an opening parenthesis", () => {
    expect(recognized("line one\n/review")).toEqual(["review"]);
    expect(recognized("(/review)")).toEqual(["review"]);
  });
});

describe("parseInlineCommands: what is not a command", () => {
  it("reports unknown /words as unrecognized and leaves them in the prompt", () => {
    const cmds = commands("try /nope here");
    expect(cmds).toMatchObject([{ name: "nope", recognized: false }]);
    expect(prompt("try /nope here")).toBe("try /nope here");
  });
  it("does not treat chat-wide commands as inline activations", () => {
    expect(commands("then /clear it")).toMatchObject([{ name: "clear", recognized: false }]);
  });
  it("ignores paths", () => {
    expect(commands("run /usr/bin/env and /review/x")).toEqual([]);
    expect(commands("open /notes.txt")).toEqual([]);
  });
  it("ignores URLs and slashes inside words", () => {
    expect(commands("see https://example.dev/review and a/review")).toEqual([]);
  });
  it("ignores code spans and fences", () => {
    expect(recognized("use `/review` literally")).toEqual([]);
    expect(recognized("```\n/review\n```\nafter")).toEqual([]);
  });
  it("treats an unclosed backtick as plain text", () => {
    expect(recognized("a ` b /review")).toEqual(["review"]);
  });
  it("does not match a bare slash or one followed by punctuation", () => {
    expect(commands("a / b")).toEqual([]);
    expect(commands("a /- b")).toEqual([]);
  });
});

describe("parseInlineCommands: punctuation and escaping", () => {
  it("allows closing punctuation after the token, which stays text", () => {
    expect(recognized("check it /review.")).toEqual(["review"]);
    expect(recognized("check /review, then ship")).toEqual(["review"]);
    expect(prompt("check it /review.")).toBe("check it.");
    expect(prompt("check /review, then ship")).toBe("check, then ship");
  });
  it("escapes with a backslash: not recognized, sent without the backslash", () => {
    expect(recognized("write \\/review in the docs")).toEqual([]);
    expect(prompt("write \\/review in the docs")).toBe("write /review in the docs");
  });
  it("keeps a backslash in front of an unknown name", () => {
    expect(prompt("path \\/nope")).toBe("path \\/nope");
  });
});

describe("/skill and /skills forms", () => {
  it("/skill <name> uses the skill for this message", () => {
    expect(commands("do it /skill review")).toMatchObject([{ text: "/skill review", recognized: true, skill: "review", scope: "turn" }]);
  });
  it("/skills <name> pins the skill for the chat", () => {
    const segs = parseInlineCommands("/skills review audit the code", SKILLS);
    expect(inlineActivations(segs)).toEqual({ turn: [], session: ["review"] });
    expect(promptWithoutCommands(segs)).toBe("audit the code");
  });
  it("/skill followed by an unknown word is not recognized", () => {
    expect(commands("/skill nope x")).toMatchObject([{ name: "skill", recognized: false }]);
  });
  it("/skill does not reach across a newline", () => {
    expect(commands("/skill\n/review")).toMatchObject([{ name: "skill", recognized: false }, { name: "review", recognized: true }]);
  });
});

describe("inlineActivations and promptWithoutCommands", () => {
  it("strips the token and one adjoining space", () => {
    expect(prompt("summarize this repo /codebase-health-sweep")).toBe("summarize this repo");
    expect(prompt("please /review the diff")).toBe("please the diff");
    expect(prompt("/review this diff")).toBe("this diff");
  });
  it("dedupes repeated skills", () => {
    expect(inlineActivations(parseInlineCommands("/review a /review b", SKILLS))).toEqual({ turn: ["review"], session: [] });
  });
  it("leaves code indentation alone", () => {
    expect(prompt("fix:\n    if (a)  b\n/review")).toBe("fix:\n    if (a)  b");
  });
  it("gives an empty prompt for a message that is only a command", () => {
    expect(prompt("/review")).toBe("");
  });
});

describe("removeSkillTokens", () => {
  it("removes every token of that skill and keeps the rest", () => {
    expect(removeSkillTokens("a /review b /skill review c /codebase-health-sweep", SKILLS, "review")).toBe("a b c /codebase-health-sweep");
  });
  it("trims the space the removed token leaves at either end", () => {
    expect(removeSkillTokens("summarize /review", SKILLS, "review")).toBe("summarize");
    expect(removeSkillTokens("/review summarize", SKILLS, "review")).toBe("summarize");
  });
});

describe("inlineTrigger", () => {
  it("finds the partial token ending at the caret", () => {
    const t = "summarize /cod";
    expect(inlineTrigger(t, t.length)).toEqual({ start: 10, end: 14, query: "cod" });
  });
  it("opens right after a slash typed after whitespace", () => {
    expect(inlineTrigger("hello /", 7)).toEqual({ start: 6, end: 7, query: "" });
  });
  it("works mid-text when the caret is at the end of the word", () => {
    expect(inlineTrigger("a /rev b", 6)).toEqual({ start: 2, end: 6, query: "rev" });
  });
  it("is null inside a word, a path, a URL or code", () => {
    expect(inlineTrigger("a /rev", 4)).toBeNull();
    expect(inlineTrigger("/usr/bi", 7)).toBeNull();
    expect(inlineTrigger("https://x.dev/re", 16)).toBeNull();
    expect(inlineTrigger("```\n/re", 7)).toBeNull();
    expect(inlineTrigger("`a /re` x", 6)).toBeNull();
  });
  it("is null when the caret is not after a slash word", () => {
    expect(inlineTrigger("hello", 5)).toBeNull();
    expect(inlineTrigger("", 0)).toBeNull();
  });
});

describe("triggerIsComplete", () => {
  it("is true only when the partial names a skill in full", () => {
    expect(triggerIsComplete({ start: 0, end: 7, query: "review" }, SKILLS)).toBe(true);
    expect(triggerIsComplete({ start: 0, end: 4, query: "rev" }, SKILLS)).toBe(false);
    expect(triggerIsComplete({ start: 0, end: 1, query: "" }, SKILLS)).toBe(false);
    expect(triggerIsComplete(null, SKILLS)).toBe(false);
  });
});

describe("insertAtCaret", () => {
  it("inserts at the caret and never drops the draft", () => {
    expect(insertAtCaret("summarize this", 9, 9, "/review", { trailingSpace: true })).toEqual({ text: "summarize /review this", caret: 17 });
  });
  it("adds a leading space only when the text before is not whitespace", () => {
    expect(insertAtCaret("hello", 5, 5, "/review", { trailingSpace: true })).toEqual({ text: "hello /review ", caret: 14 });
    expect(insertAtCaret("hello ", 6, 6, "/review", { trailingSpace: true })).toEqual({ text: "hello /review ", caret: 14 });
    expect(insertAtCaret("", 0, 0, "/review", { trailingSpace: true })).toEqual({ text: "/review ", caret: 8 });
  });
  it("replaces a selected range (the typed partial)", () => {
    expect(insertAtCaret("go /cod now", 3, 7, "/codebase-health-sweep", { trailingSpace: true }).text).toBe("go /codebase-health-sweep now");
  });
  it("uses the given separator for block inserts", () => {
    expect(insertAtCaret("intro", 5, 5, "line1\nline2", { sep: "\n" })).toEqual({ text: "intro\nline1\nline2", caret: 17 });
    expect(insertAtCaret("ab", 1, 1, "X", { sep: "\n" }).text).toBe("a\nXb");
  });
  it("clamps an out-of-range caret", () => {
    expect(insertAtCaret("abc", 99, 99, "/review").text).toBe("abc /review");
  });
});

describe("highlightPieces", () => {
  it("marks recognized tokens and merges the rest", () => {
    expect(highlightPieces(parseInlineCommands("a /nope /review.", SKILLS))).toEqual([
      { text: "a /nope ", mark: false },
      { text: "/review", mark: true },
      { text: ".", mark: false },
    ]);
  });
});
