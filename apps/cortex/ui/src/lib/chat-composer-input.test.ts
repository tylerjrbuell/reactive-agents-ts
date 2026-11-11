import { describe, expect, it } from "bun:test";
import { draftSkills, pickSkill, routeComposerInput, type SkillPickSource } from "./chat-composer-input.js";

const SKILLS = ["codebase-health-sweep", "review", "plan"];

describe("routeComposerInput", () => {
  it("sends an end-of-prompt skill as a message with the skill for this turn", () => {
    expect(routeComposerInput("summarize this repo /codebase-health-sweep", SKILLS)).toEqual({
      kind: "message",
      prompt: "summarize this repo",
      turnSkills: ["codebase-health-sweep"],
      sessionSkills: [],
    });
  });
  it("routes a leading skill name with a prompt as a message, not an unknown command", () => {
    expect(routeComposerInput("/review the last diff", SKILLS)).toMatchObject({ kind: "message", prompt: "the last diff", turnSkills: ["review"] });
  });
  it("routes /skill <name> <prompt> and /skills <name> <prompt> as messages", () => {
    expect(routeComposerInput("/skill review check it", SKILLS)).toMatchObject({ kind: "message", prompt: "check it", turnSkills: ["review"] });
    expect(routeComposerInput("/skills review check it", SKILLS)).toMatchObject({ kind: "message", prompt: "check it", sessionSkills: ["review"] });
  });
  it("keeps a leading real command in charge of the whole message", () => {
    const r = routeComposerInput("/plan refactor auth /review", SKILLS);
    expect(r.kind).toBe("command");
    if (r.kind === "command") expect(r.command?.name).toBe("plan");
  });
  it("lets a command name win over a skill with the same name at the start", () => {
    expect(routeComposerInput("/plan x", SKILLS)).toMatchObject({ kind: "command" });
  });
  it("reports a message that is only skill tokens", () => {
    expect(routeComposerInput("/review", SKILLS)).toEqual({ kind: "skills-only", skills: ["review"] });
    expect(routeComposerInput("/skill review", SKILLS)).toEqual({ kind: "skills-only", skills: ["review"] });
  });
  it("keeps an unknown leading /word a command (unknown-command hint)", () => {
    expect(routeComposerInput("/nope here", SKILLS)).toMatchObject({ kind: "command", command: undefined });
  });
  it("sends unknown mid-text /words and paths as typed", () => {
    expect(routeComposerInput("check /usr/bin and /nope", SKILLS)).toEqual({ kind: "message", prompt: "check /usr/bin and /nope", turnSkills: [], sessionSkills: [] });
  });
  it("treats skills not yet loaded as plain text", () => {
    expect(routeComposerInput("summarize /review", [])).toMatchObject({ kind: "message", prompt: "summarize /review", turnSkills: [] });
  });
});

describe("draftSkills", () => {
  it("lists each recognized skill once", () => {
    expect(draftSkills("/review a /skills review /codebase-health-sweep", SKILLS)).toEqual(["review", "codebase-health-sweep"]);
  });
});

describe("pickSkill never overwrites the draft", () => {
  const src = (over: Partial<SkillPickSource>): SkillPickSource => ({ message: "", trigger: null, chipStash: null, chipCaret: null, chipActive: false, ...over });

  it("inline menu: completes the partial at the caret and keeps the text around it", () => {
    const message = "summarize /cod and more";
    expect(pickSkill(src({ message, trigger: { start: 10, end: 14, query: "cod" } }), SKILLS, "codebase-health-sweep")).toEqual({
      text: "summarize /codebase-health-sweep and more",
      caret: 32,
    });
  });
  it("quick-bar chip: inserts the token into the stashed draft at its caret", () => {
    expect(pickSkill(src({ message: "/skill ", chipActive: true, chipStash: "summarize this repo", chipCaret: 9 }), SKILLS, "review")).toEqual({
      text: "summarize /review this repo",
      caret: 17,
    });
  });
  it("quick-bar chip with no caret appends to the draft", () => {
    expect(pickSkill(src({ message: "/skill ", chipActive: true, chipStash: "summarize", chipCaret: null }), SKILLS, "review").text).toBe("summarize /review ");
  });
  it("quick-bar chip: picking a skill already in the draft removes it (toggle) and keeps the rest", () => {
    expect(pickSkill(src({ message: "/skill ", chipActive: true, chipStash: "summarize /review now", chipCaret: 3 }), SKILLS, "review").text).toBe("summarize now");
  });
  it("a leading /partial that is the whole composer becomes the token", () => {
    expect(pickSkill(src({ message: "/rev" }), SKILLS, "review")).toEqual({ text: "/review ", caret: 8 });
  });
});
