import { describe, expect, it } from "bun:test";
import { debriefEmptyState, debriefSwitchHint, debriefsOn, memoryForDebriefs } from "./debrief-memory.js";

const off = { working: false, episodic: false, semantic: false };

describe("debriefs follow memory", () => {
  it("on when any memory tier is on", () => {
    expect(debriefsOn(off)).toBe(false);
    expect(debriefsOn({ ...off, semantic: true })).toBe(true);
  });

  it("switching on turns working memory on only when all tiers are off; off turns every tier off", () => {
    expect(memoryForDebriefs(off, true)).toEqual({ ...off, working: true });
    const episodic = { ...off, episodic: true };
    expect(memoryForDebriefs(episodic, true)).toBe(episodic);
    expect(memoryForDebriefs({ working: true, episodic: true, semantic: true }, false)).toEqual(off);
  });

  it("the hint says why it is on, or what turning it on does", () => {
    expect(debriefSwitchHint({ ...off, working: true })).toContain("On because memory is on");
    expect(debriefSwitchHint(off)).toContain("turns working memory on");
  });
});

describe("run view without a debrief", () => {
  it("loading and live runs say so", () => {
    expect(debriefEmptyState("loading", "r1", null).text).toBe("Loading the run…");
    expect(debriefEmptyState("live", "r1", null).text).toContain("when the run finishes");
  });

  it("memory off: names the real rule (memory), never an Observability setting, and links the config", () => {
    const s = debriefEmptyState("completed", "r 1", { memory: off });
    expect(s.text).toContain("memory on");
    expect(s.text).not.toContain("Observability");
    expect(s.href).toBe("/lab?fromRun=r%201");
  });

  it("no launch snapshot (a chat turn): the rule, no link", () => {
    expect(debriefEmptyState("completed", "r1", null)).toEqual({
      text: expect.stringContaining("memory on") as unknown as string,
    });
  });

  it("memory was on: says when the framework skips it, no link", () => {
    const s = debriefEmptyState("failed", "r1", { memory: { ...off, working: true } });
    expect(s.text).toContain("although memory was on");
    expect(s.href).toBeUndefined();
  });
});
