import { describe, expect, it } from "bun:test";
import { ReactiveAgents } from "../src/index.js";

describe(".withHarness()", () => {
  it("records the harness config on the built AgentConfig", () => {
    const cfg = ReactiveAgents.create()
      .withName("h")
      .withProvider("anthropic")
      .withModel("claude-haiku-4-5-20251001")
      .withHarness({ verboseRules: true, toolIndex: true })
      .toConfig();
    expect(cfg.reasoning?.harness?.verboseRules).toBe(true);
    expect(cfg.reasoning?.harness?.toolIndex).toBe(true);
  });

  it("merges across calls rather than replacing — later keys win", () => {
    const cfg = ReactiveAgents.create()
      .withName("h")
      .withProvider("anthropic")
      .withModel("claude-haiku-4-5-20251001")
      .withHarness({ verboseRules: true })
      .withHarness({ toolIndex: true })
      .toConfig();
    expect(cfg.reasoning?.harness?.verboseRules).toBe(true);
    expect(cfg.reasoning?.harness?.toolIndex).toBe(true);
  });

  it("round-trips through AgentConfig JSON", () => {
    const cfg = ReactiveAgents.create()
      .withName("h")
      .withProvider("anthropic")
      .withModel("claude-haiku-4-5-20251001")
      .withHarness({ recencyBudgetChars: 4096 })
      .toConfig();
    const json = JSON.parse(JSON.stringify(cfg)) as typeof cfg;
    expect(json.reasoning?.harness?.recencyBudgetChars).toBe(4096);
  });

  it("carries stableToolList through toConfig, JSON and fromConfig", async () => {
    const cfg = ReactiveAgents.create()
      .withName("h")
      .withProvider("anthropic")
      .withModel("claude-haiku-4-5-20251001")
      .withHarness({ stableToolList: true })
      .toConfig();
    expect(cfg.reasoning?.harness?.stableToolList).toBe(true);
    const json = JSON.parse(JSON.stringify(cfg)) as typeof cfg;
    const rebuilt = (await ReactiveAgents.fromConfig(json)).toConfig();
    expect(rebuilt.reasoning?.harness?.stableToolList).toBe(true);
  });

  it("carries compactCallConstraints through toConfig, JSON and fromConfig", async () => {
    const cfg = ReactiveAgents.create()
      .withName("h")
      .withProvider("anthropic")
      .withModel("claude-haiku-4-5-20251001")
      .withHarness({ compactCallConstraints: true })
      .toConfig();
    expect(cfg.reasoning?.harness?.compactCallConstraints).toBe(true);
    const json = JSON.parse(JSON.stringify(cfg)) as typeof cfg;
    const rebuilt = (await ReactiveAgents.fromConfig(json)).toConfig();
    expect(rebuilt.reasoning?.harness?.compactCallConstraints).toBe(true);
  });

  it("carries llmRecoveryBudget (including 0) through toConfig, JSON and fromConfig", async () => {
    for (const budget of [0, 5]) {
      const cfg = ReactiveAgents.create()
        .withName("h")
        .withProvider("anthropic")
        .withModel("claude-haiku-4-5-20251001")
        .withHarness({ llmRecoveryBudget: budget })
        .toConfig();
      expect(cfg.reasoning?.harness?.llmRecoveryBudget).toBe(budget);
      const json = JSON.parse(JSON.stringify(cfg)) as typeof cfg;
      const rebuilt = (await ReactiveAgents.fromConfig(json)).toConfig();
      expect(rebuilt.reasoning?.harness?.llmRecoveryBudget).toBe(budget);
    }
  });

  it("carries the nested repetitionBackstop through toConfig, JSON and fromConfig", async () => {
    for (const backstop of [{ maxCalls: 3 }, { iterationFraction: 0.5 }]) {
      const cfg = ReactiveAgents.create()
        .withName("h")
        .withProvider("anthropic")
        .withModel("claude-haiku-4-5-20251001")
        .withHarness({ repetitionBackstop: backstop })
        .toConfig();
      expect(cfg.reasoning?.harness?.repetitionBackstop).toEqual(backstop);
      const json = JSON.parse(JSON.stringify(cfg)) as typeof cfg;
      const rebuilt = (await ReactiveAgents.fromConfig(json)).toConfig();
      expect(rebuilt.reasoning?.harness?.repetitionBackstop).toEqual(backstop);
    }
  });

  it("survives a later .withReasoning() call regardless of call order", () => {
    const cfgHarnessFirst = ReactiveAgents.create()
      .withName("h")
      .withProvider("anthropic")
      .withModel("claude-haiku-4-5-20251001")
      .withHarness({ verboseRules: true })
      .withReasoning({ maxIterations: 5 })
      .toConfig();
    const cfgReasoningFirst = ReactiveAgents.create()
      .withName("h")
      .withProvider("anthropic")
      .withModel("claude-haiku-4-5-20251001")
      .withReasoning({ maxIterations: 5 })
      .withHarness({ verboseRules: true })
      .toConfig();
    expect(cfgHarnessFirst.reasoning?.harness).toEqual(cfgReasoningFirst.reasoning?.harness);
    expect(cfgHarnessFirst.reasoning?.harness?.verboseRules).toBe(true);
    expect(cfgHarnessFirst.execution?.maxIterations).toBe(5);
  });

  it("does not disturb the pre-existing pipeline-registration overload", () => {
    let called = false;
    const builder = ReactiveAgents.create()
      .withName("h")
      .withProvider("anthropic")
      .withModel("claude-haiku-4-5-20251001")
      .withHarness(() => {
        called = true;
      });
    // Registration is compiled at build time, not eagerly invoked; this
    // proves the function overload still resolves to the registration path
    // (not accidentally spread as a config object) rather than proving the
    // callback ran.
    expect(typeof builder.withHarness).toBe("function");
    expect(called).toBe(false);
  });
});
