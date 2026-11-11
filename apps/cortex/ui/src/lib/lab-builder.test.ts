import { describe, expect, test } from "bun:test";
import {
  adHocPrimaryDisabled,
  adHocPrimaryTitle,
  builderConfigFromAgent,
  builderDefaults,
  exampleBuilderConfig,
  importBuilderConfig,
  launchSummaryOf,
  prefillFromSnapshot,
  relativeTime,
  type BuilderAgentConfig,
} from "./lab-builder.js";

const defaults = (): BuilderAgentConfig => builderDefaults({ defaultProvider: "ollama", defaultModel: "qwen3:14b" });

describe("builderDefaults", () => {
  test("takes provider and model from settings", () => {
    expect(defaults()).toMatchObject({ provider: "ollama", model: "qwen3:14b" });
  });
});

describe("ad-hoc launch button", () => {
  const s = { busy: false, prompt: "do it", name: "agent" } as const;
  test("disabled while busy", () => {
    expect(adHocPrimaryDisabled({ ...s, action: "run", busy: true })).toBe(true);
  });
  test("each action needs its inputs", () => {
    expect(adHocPrimaryDisabled({ ...s, action: "run", prompt: " " })).toBe(true);
    expect(adHocPrimaryDisabled({ ...s, action: "run", name: "" })).toBe(false);
    expect(adHocPrimaryDisabled({ ...s, action: "save", prompt: "" })).toBe(false);
    expect(adHocPrimaryDisabled({ ...s, action: "save", name: "" })).toBe(true);
    expect(adHocPrimaryDisabled({ ...s, action: "save-run", prompt: "" })).toBe(true);
    expect(adHocPrimaryDisabled({ ...s, action: "save-run" })).toBe(false);
  });
  test("Save and run without a task explains why", () => {
    expect(adHocPrimaryTitle({ ...s, action: "save-run", prompt: "" })).toContain("Add a task");
    expect(adHocPrimaryTitle({ ...s, action: "save-run" })).toBeUndefined();
    expect(adHocPrimaryTitle({ ...s, action: "run", prompt: "" })).toBeUndefined();
  });
});

describe("prefillFromSnapshot", () => {
  test("copies listed keys over the current config and skips null / unlisted ones", () => {
    const out = prefillFromSnapshot(defaults(), { prompt: "p", maxIterations: 7, systemPrompt: null, durableRuns: { enabled: true } });
    expect(out.prompt).toBe("p");
    expect(out.maxIterations).toBe(7);
    expect(out.systemPrompt).toBe(defaults().systemPrompt);
    expect(out.durableRuns).toEqual(defaults().durableRuns);
  });
});

describe("builderConfigFromAgent", () => {
  test("merges nested blocks over defaults and copies arrays", () => {
    const base = defaults();
    const providers = ["anthropic"];
    const src = { ...base, fallbacks: { ...base.fallbacks, providers }, skills: { paths: ["a"], activate: ["s1"] } } as BuilderAgentConfig;
    const out = builderConfigFromAgent(base, src);
    expect(out.fallbacks.providers).toEqual(["anthropic"]);
    expect(out.fallbacks.providers).not.toBe(providers);
    expect(out.skills).toEqual({ paths: ["a"], activate: ["s1"] });
  });
  test("an empty activate list is dropped", () => {
    const base = defaults();
    const out = builderConfigFromAgent(base, { ...base, skills: { paths: [], activate: [] } } as BuilderAgentConfig);
    expect(out.skills).toEqual({ paths: [] });
  });
});

describe("relativeTime", () => {
  test("buckets", () => {
    expect(relativeTime(undefined)).toBe("never");
    expect(relativeTime(1, 10_000)).toBe("just now");
    expect(relativeTime(1, 5 * 60_000)).toBe("5 minutes ago");
    expect(relativeTime(1, 2 * 3_600_000 + 1)).toBe("2 hours ago");
  });
});

describe("launch panel summary", () => {
  test("model, strategy label, tools (the host shell counts) and workspace", () => {
    const c = { ...defaults(), strategy: "reactive", tools: ["web-search", "git"], terminalTools: true, workspace: "/home/me/code" };
    expect(launchSummaryOf(c, "ReAct")).toEqual([
      { label: "Model", value: "ollama / qwen3:14b" },
      { label: "Strategy", value: "ReAct" },
      { label: "Tools", value: "3" },
      { label: "Workspace", value: "/home/me/code" },
    ]);
  });
  test("falls back to the strategy id, None for no tools or workspace, and the default model", () => {
    const rows = launchSummaryOf({ ...defaults(), model: " ", strategy: "adaptive", tools: [], terminalTools: false, workspace: "" });
    expect(rows.map((r) => r.value)).toEqual(["ollama / default model", "adaptive", "None", "None"]);
  });
});

describe("Lab header: Load example and Import", () => {
  test("the example keeps the current provider and model", () => {
    const ex = exampleBuilderConfig(defaults());
    expect(ex).toMatchObject({ provider: "ollama", model: "qwen3:14b", strategy: "plan-execute-reflect", tools: ["web-search", "file-write"] });
    expect(ex.memory.episodic).toBe(true);
  });
  test("import merges a JSON object over the defaults; anything else is refused", () => {
    const imported = importBuilderConfig(defaults(), JSON.stringify({ strategy: "reflexion", memory: { semantic: true } }));
    expect(imported?.strategy).toBe("reflexion");
    expect(imported?.memory.semantic).toBe(true);
    expect(imported?.memory.working).toBe(defaults().memory.working);
    expect(importBuilderConfig(defaults(), "not json")).toBeNull();
    expect(importBuilderConfig(defaults(), "[1,2]")).toBeNull();
    expect(importBuilderConfig(defaults(), "null")).toBeNull();
  });
});
