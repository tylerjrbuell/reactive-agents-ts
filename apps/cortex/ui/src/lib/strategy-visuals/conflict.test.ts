import { describe, expect, it } from "bun:test";
import { strategyConflictOfConfig } from "./conflict.js";

describe("strategyConflictOfConfig", () => {
  it("code-action with the default gate conflicts; the resolutions patch the config, never silently", () => {
    const c = strategyConflictOfConfig({ strategy: "code-action", askBeforeRiskyTools: true });
    expect(c?.resolutions.map((r) => r.patch)).toEqual([{ strategy: "reactive" }, { askBeforeRiskyTools: false }]);
  });

  it("an explicit policy keeps only the strategy switch", () => {
    const c = strategyConflictOfConfig({ strategy: "code-action", approvalPolicy: { mode: "detach", tools: ["file-write"], commands: [] } });
    expect(c?.resolutions.map((r) => r.id)).toEqual(["switch-strategy"]);
  });

  it("no conflict once approvals are off, for other strategies, or for a chat with tools off", () => {
    expect(strategyConflictOfConfig({ strategy: "code-action", askBeforeRiskyTools: false })).toBeUndefined();
    expect(strategyConflictOfConfig({ strategy: "reactive" })).toBeUndefined();
    expect(strategyConflictOfConfig({ strategy: "code-action" }, { toolsEnabled: false })).toBeUndefined();
  });

  it("applying the turn-off resolution clears the conflict", () => {
    const cfg = { strategy: "code-action" };
    const turnOff = strategyConflictOfConfig(cfg)!.resolutions.find((r) => r.id === "turn-off-approvals")!;
    expect(strategyConflictOfConfig({ ...cfg, ...turnOff.patch })).toBeUndefined();
  });
});
