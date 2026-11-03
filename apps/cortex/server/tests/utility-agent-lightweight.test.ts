import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cortexParamsToAgentConfig } from "../services/cortex-to-agent-config.js";
import { UTILITY_AGENT_PARAMS } from "../services/utility-agent.js";

const services = join(import.meta.dir, "..", "services");

describe("Cortex utility prompts run the lightweight one-shot path", () => {
  it("UTILITY_AGENT_PARAMS compiles to the direct strategy capped at one iteration", () => {
    const cfg = cortexParamsToAgentConfig({ agentName: "u", provider: "test", ...UTILITY_AGENT_PARAMS });
    expect(cfg.reasoning?.defaultStrategy).toBe("direct");
    expect(cfg.execution?.maxIterations).toBe(1);
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
});
