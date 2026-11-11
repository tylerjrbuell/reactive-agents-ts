import { describe, expect, test } from "bun:test";
import { AGENT_CONFIG_SECTIONS, activeSectionIds, sectionCopy, sectionVisible } from "./agent-config-sections.js";

describe("agent config section registry", () => {
  test("13 sections in panel order", () => {
    expect(AGENT_CONFIG_SECTIONS.map((s) => s.id)).toEqual([
      "inference", "persona", "strategy", "variables", "tools", "subagents", "skills",
      "memory", "guardrails", "execution", "metatools", "reliability", "observability",
    ]);
  });
  test("compact hides variables, tools, sub-agents and skills", () => {
    expect(activeSectionIds(true)).toEqual(["inference", "persona", "strategy", "memory", "guardrails", "execution", "metatools", "reliability", "observability"]);
    expect(activeSectionIds(false)).toHaveLength(13);
  });
  test("copy falls back to the id", () => {
    expect(sectionCopy("strategy").label).toBe("Reasoning");
    expect(sectionCopy("nope")).toEqual({ label: "nope", keywords: "nope" });
  });
  test("filter matches title (any case), keywords or id", () => {
    expect(sectionVisible("strategy", "reason", false)).toBe(true);
    expect(sectionVisible("strategy", "REFLEXION", false)).toBe(true);
    expect(sectionVisible("execution", "timeout", false)).toBe(true);
    expect(sectionVisible("metatools", "metatool", false)).toBe(true);
    expect(sectionVisible("memory", "timeout", false)).toBe(false);
    expect(sectionVisible("tools", "", true)).toBe(false);
    expect(sectionVisible("tools", "  ", false)).toBe(true);
  });
});
