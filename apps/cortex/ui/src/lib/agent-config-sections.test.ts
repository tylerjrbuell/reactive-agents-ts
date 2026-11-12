import { describe, expect, test } from "bun:test";
import {
  AGENT_CONFIG_SECTIONS,
  BUILDER_NAV,
  activeSectionIds,
  builderNavCount,
  builderNavEntry,
  filterBuilderNav,
  navEntryOfSection,
  sectionCopy,
  sectionVisible,
} from "./agent-config-sections.js";

describe("agent config section registry", () => {
  test("16 sections in panel order", () => {
    expect(AGENT_CONFIG_SECTIONS.map((s) => s.id)).toEqual([
      "inference", "persona", "strategy", "variables", "tools", "subagents", "skills",
      "memory", "guardrails", "execution", "channels", "outputschema", "judgment", "metatools", "reliability", "observability",
    ]);
  });
  test("compact hides variables, tools, sub-agents, skills and channels", () => {
    expect(activeSectionIds(true)).toEqual(["inference", "persona", "strategy", "memory", "guardrails", "execution", "outputschema", "judgment", "metatools", "reliability", "observability"]);
    expect(activeSectionIds(false)).toHaveLength(16);
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
  test("17 entries: 16 grouped from the panel's 16 sections and Shell, plus All framework options", () => {
    expect(BUILDER_NAV.map((e) => e.label)).toEqual([
      "Model", "Persona", "Variables", "Reasoning", "Tools", "Shell and workspace", "Sub-agents", "Skills",
      "Memory", "Guardrails", "Execution", "Channels", "Output schema", "Judgment", "Reliability", "Observability", "All framework options",
    ]);
  });
  test("every panel section is reachable from exactly one entry", () => {
    const members = BUILDER_NAV.flatMap((e) => e.sections).filter((id) => id !== "shell" && id !== "framework");
    expect([...members].sort()).toEqual(AGENT_CONFIG_SECTIONS.map((s) => s.id).sort());
    expect(builderNavEntry("persona").sections).toEqual(["persona"]);
    expect(builderNavEntry("variables").sections).toEqual(["variables"]);
    expect(builderNavEntry("tools").sections).toEqual(["tools", "metatools"]);
    expect(builderNavEntry("nope").id).toBe("model");
  });
  test("Find a setting matches titles, member keywords and the entry's own words", () => {
    expect(filterBuilderNav("").length).toBe(17);
    expect(filterBuilderNav("typesafe").map((e) => e.id)).toEqual(["judgment"]);
    expect(filterBuilderNav("temperature").map((e) => e.id)).toEqual(["model"]);
    expect(filterBuilderNav("template").map((e) => e.id)).toEqual(["variables"]);
    expect(filterBuilderNav("variable").map((e) => e.id)).toEqual(["variables"]);
    expect(filterBuilderNav("conductor").map((e) => e.id)).toEqual(["tools"]);
    expect(filterBuilderNav("workspace").map((e) => e.id)).toContain("shell");
    expect(filterBuilderNav("MANIFEST").map((e) => e.id)).toEqual(["framework"]);
    expect(filterBuilderNav("zzzz")).toEqual([]);
  });
  test("each setting has one guessable home: search lands on the section that renders it", () => {
    expect(filterBuilderNav("approval").map((e) => e.id)).toEqual(["tools"]);
    expect(filterBuilderNav("spawn").map((e) => e.id)).toEqual(["subagents"]);
    expect(filterBuilderNav("dynamic").map((e) => e.id)).toEqual(["subagents"]);
    expect(filterBuilderNav("recursion").map((e) => e.id)).toEqual(["subagents"]);
    expect(filterBuilderNav("durable").map((e) => e.id)).toEqual(["execution"]);
    // Two different things: lifecycle webhooks (Execution) and a webhook messaging channel (Channels).
    expect(filterBuilderNav("webhook").map((e) => e.id)).toEqual(["execution", "channels"]);
    expect(filterBuilderNav("telegram").map((e) => e.id)).toEqual(["channels"]);
    expect(filterBuilderNav("senders").map((e) => e.id)).toEqual(["channels"]);
    expect(filterBuilderNav("output schema").map((e) => e.id)).toEqual(["outputschema"]);
    expect(filterBuilderNav("request_user_input").map((e) => e.id)).toEqual(["execution"]);
    expect(filterBuilderNav("budget").map((e) => e.id)).toEqual(["execution"]);
    expect(filterBuilderNav("routing").map((e) => e.id)).toEqual(["model"]);
    expect(filterBuilderNav("documents").map((e) => e.id)).toEqual(["memory"]);
  });
  test("config paths sit with the section whose controls set them", () => {
    const owner = (path: string) => AGENT_CONFIG_SECTIONS.find((s) => s.configPaths.includes(path))?.id;
    expect(owner("approvalPolicy")).toBe("tools");
    expect(owner("dynamicSubAgents")).toBe("subagents");
    expect(owner("budget.tokenLimit")).toBe("execution");
    expect(owner("outputSchema")).toBe("outputschema");
    expect(owner("outputSchemaOptions")).toBe("outputschema");
    expect(owner("userInteraction")).toBe("execution");
    expect(owner("modelRouting.minTier")).toBe("inference");
    expect(owner("documents")).toBe("memory");
    expect(owner("gateway.accessControl")).toBe("channels");
    expect(owner("gateway.queue")).toBe("channels");
    expect(owner("gateway.crons")).toBe("channels");
    const reasoning = AGENT_CONFIG_SECTIONS.find((s) => s.id === "strategy")!;
    expect(reasoning.configPaths.filter((p) => !/^(reasoning|execution\.(max|min)Iterations|verificationStep|features\.verification|grounding|fabricationGuard)/.test(p))).toEqual([]);
  });
  test("a panel section maps to the nav entry that shows it", () => {
    expect(navEntryOfSection("execution")).toBe("execution");
    expect(navEntryOfSection("metatools")).toBe("tools");
    expect(navEntryOfSection("variables")).toBe("variables");
    expect(navEntryOfSection("nope")).toBeUndefined();
  });
  test("Tools shows the selection count, the host shell included", () => {
    expect(builderNavCount("tools", { tools: ["web-search", "git"], terminalTools: true })).toBe(3);
    expect(builderNavCount("tools", { tools: [] })).toBeUndefined();
    expect(builderNavCount("model", { tools: ["x"] })).toBeUndefined();
  });
});
