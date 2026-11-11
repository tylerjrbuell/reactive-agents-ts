import { describe, expect, it } from "bun:test";
import type { ConfigFieldDescriptor } from "./capabilities.js";
import { AGENT_CONFIG_SECTIONS, isCuratedConfigPath } from "./agent-config-sections.js";
import { choiceFromKey, choiceKey, genericConfigFields } from "./framework-options.js";

const field = (path: string, type: ConfigFieldDescriptor["type"] = "boolean"): ConfigFieldDescriptor => ({ path, type, optional: true });

describe("All framework options: which fields render", () => {
  it("hides every path a curated section sets, sub-paths included", () => {
    for (const path of [
      "reasoning.synthesis",
      "reasoning.harness.toolIndex",
      "skills.global",
      "dynamicSubAgents.maxIterations",
      "verificationStep.mode",
      "modelRouting.minTier",
      "persona.role",
      "memory.tier",
      "observability.verbosity",
      "logging.level",
      "execution.retryPolicy.maxRetries",
      "features.killSwitch",
    ]) {
      expect(isCuratedConfigPath(path)).toBe(true);
      expect(genericConfigFields([field(path, "string")])).toEqual([]);
    }
  });

  it("renders framework paths no section sets, including the newer reasoning options", () => {
    const shown = genericConfigFields([
      field("reasoning.strategies.reactive.maxIterations", "number"),
      field("reasoning.adaptive.enabled"),
      field("reasoning.parallelToolCalls"),
      field("reasoning.observationSummary", "unknown"),
      field("dynamicSubAgents.maxRecursionDepth", "number"),
      field("verificationStep.prompt", "string"),
      field("modelRouting.tierModels.haiku", "string"),
      field("tools.builtins", "unknown"),
    ]).map((f) => f.path);
    expect(shown).toEqual([
      "reasoning.strategies.reactive.maxIterations",
      "reasoning.adaptive.enabled",
      "reasoning.parallelToolCalls",
      "reasoning.observationSummary",
      "dynamicSubAgents.maxRecursionDepth",
      "verificationStep.prompt",
      "modelRouting.tierModels.haiku",
      "tools.builtins",
    ]);
  });

  it("a prefix match needs a dot boundary: `reasoning.synthesis` does not hide `reasoning.synthesisModel`", () => {
    expect(isCuratedConfigPath("reasoning.synthesisModel")).toBe(false);
  });

  it("skips fields with no widget (unknown type, not listed)", () => {
    expect(genericConfigFields([field("circuitBreaker", "unknown"), field("pricingRegistry", "object")])).toEqual([]);
  });

  it("no path is owned by two sections", () => {
    const all = AGENT_CONFIG_SECTIONS.flatMap((s) => s.configPaths);
    expect(new Set(all).size).toBe(all.length);
  });

  it("choice fields keep true and \"true\" apart, and empty is Default", () => {
    expect(choiceFromKey("reasoning.observationSummary", choiceKey(true))).toBe(true);
    expect(choiceFromKey("reasoning.observationSummary", choiceKey("auto"))).toBe("auto");
    expect(choiceFromKey("reasoning.observationSummary", "")).toBeUndefined();
  });
});
