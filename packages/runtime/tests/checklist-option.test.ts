/**
 * `observability.checklist` display option: builder -> toConfig -> AgentConfig
 * round-trip (plan-and-goal-primitives Task 6, Decision 3). No new wither.
 *
 * Run: bun test packages/runtime/tests/checklist-option.test.ts --timeout 15000
 */
import { describe, test, expect } from "bun:test";
import { ReactiveAgents } from "../src/builder.js";
import { agentConfigToBuilder } from "../src/agent-config.js";

describe("observability.checklist option", () => {
  test("explicit false survives toConfig()", () => {
    const cfg = ReactiveAgents.create().withName("c").withObservability({ checklist: false }).toConfig();
    expect(cfg.observability?.checklist).toBe(false);
  });

  test("explicit true survives toConfig()", () => {
    const cfg = ReactiveAgents.create().withName("c").withObservability({ checklist: true }).toConfig();
    expect(cfg.observability?.checklist).toBe(true);
  });

  test("unset => absent (no default stamped into config)", () => {
    const cfg = ReactiveAgents.create().withName("c").withObservability({ verbosity: "normal" }).toConfig();
    expect(cfg.observability).toBeDefined();
    expect("checklist" in (cfg.observability ?? {})).toBe(false);
  });

  test("agentConfigToBuilder round-trips the option", async () => {
    const cfg = ReactiveAgents.create().withName("c").withObservability({ checklist: false }).toConfig();
    const rebuilt = await agentConfigToBuilder(cfg);
    expect(rebuilt.toConfig().observability?.checklist).toBe(false);
  });
});
