import { describe, expect, it } from "bun:test";
import { debriefEmptyState, debriefSwitchHint, debriefsOn, rawConfigForDebriefs } from "./debrief-memory.js";

const off = { working: false, episodic: false, semantic: false };
const on = { ...off, working: true };

describe("debriefs follow memory unless set (isDebriefEnabled: debrief ?? memory)", () => {
  it("unset: follows memory", () => {
    expect(debriefsOn(off, {})).toBe(false);
    expect(debriefsOn({ ...off, semantic: true }, {})).toBe(true);
  });

  it("explicit debrief wins either way", () => {
    expect(debriefsOn(off, { debrief: true })).toBe(true);
    expect(debriefsOn(on, { debrief: false })).toBe(false);
  });

  it("switching never touches memory; it sets rawConfig.debrief only when it differs from memory", () => {
    expect(rawConfigForDebriefs(off, {}, true)).toEqual({ debrief: true });
    expect(rawConfigForDebriefs(on, {}, false)).toEqual({ debrief: false });
    expect(rawConfigForDebriefs(on, {}, true)).toEqual({});
    expect(rawConfigForDebriefs(off, { debrief: true, x: 1 }, false)).toEqual({ x: 1 });
  });

  it("the hint says whether it follows memory or is set explicitly", () => {
    expect(debriefSwitchHint(on, {})).toContain("follows memory");
    expect(debriefSwitchHint(off, { debrief: true })).toContain("without memory");
    expect(debriefSwitchHint(on, { debrief: false })).toContain("Off although memory is on");
    expect(debriefSwitchHint(off, {})).toContain("Off while memory is off");
  });
});

describe("run view without a debrief", () => {
  it("loading and live runs say so", () => {
    expect(debriefEmptyState("loading", "r1", null).text).toBe("Loading the run…");
    expect(debriefEmptyState("live", "r1", null).text).toContain("when the run finishes");
  });

  it("memory off, debrief unset: says debrief is off, not that it needs memory, and links the config", () => {
    const s = debriefEmptyState("completed", "r 1", { memory: off });
    expect(s.text).toContain("Debrief after each run");
    expect(s.text).not.toContain("only when the agent has memory");
    expect(s.href).toBe("/lab?fromRun=r%201");
  });

  it("no launch snapshot (a chat turn): the rule, no link", () => {
    const s = debriefEmptyState("completed", "r1", null);
    expect(s.text).toContain("Debrief after each run");
    expect(s.href).toBeUndefined();
  });

  it("debrief on with memory off: says when the framework skips it", () => {
    const s = debriefEmptyState("failed", "r1", { memory: off, rawConfig: { debrief: true } });
    expect(s.text).toContain("although debrief was on");
    expect(s.href).toBeUndefined();
  });

  it("memory on, debrief unset: same skip reason", () => {
    expect(debriefEmptyState("failed", "r1", { memory: on }).text).toContain("although debrief was on");
  });

  it("debrief explicitly off: says it was turned off and links", () => {
    const s = debriefEmptyState("completed", "r1", { memory: on, rawConfig: { debrief: false } });
    expect(s.text).toContain("turned off");
    expect(s.href).toBe("/lab?fromRun=r1");
  });
});
