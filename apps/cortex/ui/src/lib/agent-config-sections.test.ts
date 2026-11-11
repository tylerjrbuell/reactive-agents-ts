import { describe, expect, test } from "bun:test";
import {
  AGENT_CONFIG_SECTIONS,
  BUILDER_NAV,
  activeSectionIds,
  builderNavCount,
  builderNavEntry,
  filterBuilderNav,
  sectionCopy,
  sectionVisible,
} from "./agent-config-sections.js";

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

describe("Lab builder section nav (registry-driven)", () => {
  test("13 entries: 12 grouped from the panel's 13 sections, plus All framework options", () => {
    expect(BUILDER_NAV.map((e) => e.label)).toEqual([
      "Model", "Persona", "Reasoning", "Tools", "Shell and workspace", "Sub-agents", "Skills",
      "Memory", "Guardrails", "Execution", "Reliability", "Observability", "All framework options",
    ]);
  });
  test("every panel section is reachable from exactly one entry", () => {
    const members = BUILDER_NAV.flatMap((e) => e.sections).filter((id) => id !== "shell" && id !== "framework");
    expect([...members].sort()).toEqual(AGENT_CONFIG_SECTIONS.map((s) => s.id).sort());
    expect(builderNavEntry("persona").sections).toEqual(["persona", "variables"]);
    expect(builderNavEntry("tools").sections).toEqual(["tools", "metatools"]);
    expect(builderNavEntry("nope").id).toBe("model");
  });
  test("Find a setting matches titles, member keywords and the entry's own words", () => {
    expect(filterBuilderNav("").length).toBe(13);
    expect(filterBuilderNav("temperature").map((e) => e.id)).toEqual(["model"]);
    expect(filterBuilderNav("template").map((e) => e.id)).toEqual(["persona"]);
    expect(filterBuilderNav("conductor").map((e) => e.id)).toEqual(["tools"]);
    expect(filterBuilderNav("workspace").map((e) => e.id)).toContain("shell");
    expect(filterBuilderNav("MANIFEST").map((e) => e.id)).toEqual(["framework"]);
    expect(filterBuilderNav("zzzz")).toEqual([]);
  });
  test("Tools shows the selection count, the host shell included", () => {
    expect(builderNavCount("tools", { tools: ["web-search", "git"], terminalTools: true })).toBe(3);
    expect(builderNavCount("tools", { tools: [] })).toBeUndefined();
    expect(builderNavCount("model", { tools: ["x"] })).toBeUndefined();
  });
});
