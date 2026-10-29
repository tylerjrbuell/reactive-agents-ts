// Run: bun test packages/reasoning/src/kernel/capabilities/act/meta-tool-arg-healing.test.ts --timeout 15000
import { describe, expect, it } from "bun:test";
import { healBriefArgs, healPulseArgs } from "./meta-tool-arg-healing.js";

describe("healBriefArgs", () => {
  it("canonical section passes through unmarked", () => {
    expect(healBriefArgs({ section: "tools" })).toEqual({ section: "tools", healing: [] });
  });
  it("case, plural and closed aliases heal and are traced", () => {
    expect(healBriefArgs({ section: "Docs" })).toEqual({
      section: "documents",
      healing: [{ stage: "param-name", from: "Docs", to: "documents" }],
    });
    expect(healBriefArgs({ section: "TOOLS" }).section).toBe("tools");
    expect(healBriefArgs({ section: "everything" }).section).toBe("all");
    expect(healBriefArgs({ section: "scratchpad" }).section).toBe("recall");
  });
  it("drifted param name `topic` heals to section", () => {
    const r = healBriefArgs({ topic: "skills" });
    expect(r.section).toBe("skills");
    expect(r.healing).toEqual([{ stage: "param-name", from: "topic", to: "section" }]);
  });
  it("unknown / absent values keep today's behavior (passed through, no trace)", () => {
    expect(healBriefArgs({ section: "banana" })).toEqual({ section: "banana", healing: [] });
    expect(healBriefArgs({})).toEqual({ section: undefined, healing: [] });
    expect(healBriefArgs(undefined)).toEqual({ section: undefined, healing: [] });
  });
});

describe("healPulseArgs", () => {
  it("canonical question passes through", () => {
    expect(healPulseArgs({ question: "am I ready?" })).toEqual({ question: "am I ready?", healing: [] });
  });
  it("drifted param names heal to question and are traced", () => {
    expect(healPulseArgs({ query: "ready?" })).toEqual({
      question: "ready?",
      healing: [{ stage: "param-name", from: "query", to: "question" }],
    });
    expect(healPulseArgs({ prompt: "x" }).question).toBe("x");
  });
  it("absent stays undefined; canonical wins over an alternate", () => {
    expect(healPulseArgs({})).toEqual({ question: undefined, healing: [] });
    expect(healPulseArgs({ question: "a", query: "b" })).toEqual({ question: "a", healing: [] });
  });
});
