// Run: bun run repo test apps/cortex/server/tests/curated-config-paths.test.ts
//
// No AgentConfig path has two controls: "All framework options" (the generic
// renderer, UI `genericConfigFields`) hides every path a curated section sets
// (`AGENT_CONFIG_SECTIONS[].configPaths`). Pinned against the real mapping: a
// config with every curated control set goes through `cortexParamsToAgentConfig`,
// and no path it writes may also render generically. A new curated mapping
// without a `configPaths` entry fails here.
import { describe, expect, it } from "bun:test";
import { tmpdir } from "node:os";
import type { Static } from "elysia";
import { getCapabilityManifest } from "@reactive-agents/runtime";
import { RunConfigBody, runBodyToLaunchParams } from "../api/runs.js";
import { launchParamsToBuildParams } from "../services/runner-service.js";
import { cortexParamsToAgentConfig } from "../services/cortex-to-agent-config.js";
import { FULL_CONFIG_BODY } from "./fixtures/full-config-body.js";
import { curatedConfigPaths } from "../../ui/src/lib/agent-config-sections.js";
import { genericConfigFields } from "../../ui/src/lib/framework-options.js";

/** Every Lab control set at once (values the UI can produce; no rawConfig). */
const everyControl = (): Record<string, unknown> => {
  const { rawConfig: _raw, ...full } = FULL_CONFIG_BODY;
  return {
    ...full,
    thinking: true,
    numCtx: 16384,
    persona: { enabled: true, role: "analyst", tone: "dry", traits: "terse", responseStyle: "bullets" },
    strategySwitching: true,
    contextSynthesis: "llm",
    harness: { toolIndex: true },
    memory: { working: true, episodic: true, semantic: true },
    observabilityVerbosity: "verbose",
    budget: { tokenLimit: 5000, costLimit: 1 },
    grounding: { mode: "warn" },
    documents: [{ source: "notes", content: "inline doc" }],
    workspace: tmpdir(),
  };
};

const getPath = (obj: unknown, path: string): unknown =>
  path.split(".").reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), obj);

describe("curated config paths", () => {
  const manifest = getCapabilityManifest();

  it("no path the curated mapping writes also renders in All framework options", () => {
    const body = everyControl();
    const params = launchParamsToBuildParams(
      runBodyToLaunchParams(body as Static<typeof RunConfigBody>, body.workspace as string),
      "anthropic",
      [],
    );
    const config = cortexParamsToAgentConfig(params);
    const doubled = genericConfigFields(manifest.configFields)
      .map((f) => f.path)
      .filter((p) => getPath(config, p) !== undefined);
    expect(doubled).toEqual([]);
  });

  it("every curated path names a real AgentConfig field (no stale entry)", () => {
    const paths = manifest.configFields.map((f) => f.path);
    const stale = curatedConfigPaths().filter((c) => !paths.some((p) => p === c || p.startsWith(`${c}.`)));
    expect(stale).toEqual([]);
  });

  it("the newer reasoning options render generically", () => {
    const shown = new Set(genericConfigFields(manifest.configFields).map((f) => f.path));
    for (const p of [
      "reasoning.strategies.reactive.maxIterations",
      "reasoning.adaptive.enabled",
      "reasoning.parallelToolCalls",
      "reasoning.observationSummary",
    ]) {
      expect(shown.has(p)).toBe(true);
    }
  });
});
