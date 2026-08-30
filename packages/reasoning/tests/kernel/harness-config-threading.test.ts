import { describe, expect, it, afterEach } from "bun:test";
import { resolveHarnessConfig } from "../../src/harness-config.js";
import { resolveToolSurface, type ToolSurfaceInputs } from "../../src/kernel/capabilities/reason/tool-surface.js";
import { resolveCapability } from "../../src/assembly/capability.js";

afterEach(() => {
  delete process.env.RA_STABLE_TOOL_SURFACE;
  delete process.env.RA_RECENCY_BUDGET_CHARS;
});

const schema = (name: string) => ({ name, description: name, parameters: {} });

function baseSurfaceInputs(harness = resolveHarnessConfig()): ToolSurfaceInputs {
  return {
    augmented: [schema("file-read"), schema("file-write"), schema("web-search")],
    finalAnswerSchema: schema("final-answer"),
    lazyMode: true,
    pressureCritical: false,
    hasClassification: false,
    requiredTools: [],
    relevantTools: ["file-read"],
    // Deliberately NOT every tool — an unconditional allowedTools floor would
    // keep all 3 visible in the lazy arm regardless of stableToolSurface,
    // masking the config-vs-env assertion below.
    allowedTools: ["file-read"],
    toolsUsed: [],
    discovered: [],
    gateBlockedTools: [],
    missingRequiredTools: [],
    pruneMinTools: 1,
    harness,
  } as ToolSurfaceInputs;
}

describe("harness config reaches the call sites", () => {
  it("stable tool surface follows the CARRIED config, not the environment", () => {
    // Environment says off; carried config says on. Config must win.
    delete process.env.RA_STABLE_TOOL_SURFACE;
    const on = resolveToolSurface(baseSurfaceInputs(resolveHarnessConfig({ stableToolSurface: true })));
    expect(on.visible.length).toBe(3);

    // Environment says on; carried config says off. Config must still win.
    process.env.RA_STABLE_TOOL_SURFACE = "1";
    const off = resolveToolSurface(baseSurfaceInputs(resolveHarnessConfig({ stableToolSurface: false })));
    expect(off.visible.length).toBeLessThan(3);
  });

  it("the recency budget follows the carried config over the environment", () => {
    process.env.RA_RECENCY_BUDGET_CHARS = "999";
    const r = resolveCapability({
      tier: "mid",
      window: 32_000,
      harness: resolveHarnessConfig({ recencyBudgetChars: 4096 }),
    } as Parameters<typeof resolveCapability>[0]);
    expect(r.recencyBudgetChars).toBe(4096);
  });
});
