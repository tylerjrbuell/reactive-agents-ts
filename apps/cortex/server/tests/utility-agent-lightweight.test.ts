import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cortexParamsToAgentConfig } from "../services/cortex-to-agent-config.js";
import { UTILITY_AGENT_PARAMS, utilityOutput } from "../services/utility-agent.js";

const services = join(import.meta.dir, "..", "services");

describe("Cortex utility prompts run the lightweight one-shot path", () => {
  it("UTILITY_AGENT_PARAMS compiles to the direct strategy capped at one iteration", () => {
    const cfg = cortexParamsToAgentConfig({ agentName: "u", provider: "test", ...UTILITY_AGENT_PARAMS });
    expect(cfg.reasoning?.defaultStrategy).toBe("direct");
    expect(cfg.execution?.maxIterations).toBe(1);
    expect(cfg.thinking).toBe(false);
  });

  // Wire-it-and-pin-it: each utility call site must spread the shared params.
  // Cutting the spread from any one builder turns this red.
  it.each([
    ["chat-session-service.ts", "chat-titler"],
    ["chat-session-service.ts", "chat-compactor"],
    ["chat-goal-service.ts", "goal-checker"],
  ])("%s builds %s with UTILITY_AGENT_PARAMS", (file, agentName) => {
    const src = readFileSync(join(services, file), "utf8");
    const at = src.indexOf(`agentName: "${agentName}"`);
    expect(at).toBeGreaterThan(-1);
    expect(src.slice(at, at + 160)).toContain("...UTILITY_AGENT_PARAMS");
  });

  // Repro (2026-11-03, cogito:8b): titling a failed first turn made the direct run fail too;
  // its failure notice "Could not complete the task within the available budget…" became the title.
  it("utilityOutput drops a failed run's failure notice", () => {
    expect(utilityOutput({ success: true, output: "Multiplication Problem" })).toBe("Multiplication Problem");
    expect(
      utilityOutput({ success: false, output: "Could not complete the task within the available budget." }),
    ).toBe("");
    expect(utilityOutput({ success: true, output: undefined })).toBe("");
  });

  // Each utility call site must read its result through utilityOutput, never raw `.output`.
  it.each([
    ["chat-session-service.ts", "chat-titler"],
    ["chat-session-service.ts", "chat-compactor"],
    ["chat-goal-service.ts", "goal-checker"],
  ])("%s reads %s output through utilityOutput", (file, agentName) => {
    const src = readFileSync(join(services, file), "utf8");
    const at = src.indexOf(`agentName: "${agentName}"`);
    const body = src.slice(at, src.indexOf("finally", at));
    expect(body).toContain("utilityOutput(");
    expect(body).not.toContain(".output ??");
  });
});
