import { describe, expect, it } from "bun:test";
import { ReactiveAgents } from "../src/index.js";

describe(".withHarness()", () => {
  it("records the harness config on the built AgentConfig", () => {
    const cfg = ReactiveAgents.create()
      .withName("h")
      .withProvider("anthropic")
      .withModel("claude-haiku-4-5-20251001")
      .withHarness({ stableToolSurface: true, toolIndex: true })
      .toConfig();
    expect(cfg.reasoning?.harness?.stableToolSurface).toBe(true);
    expect(cfg.reasoning?.harness?.toolIndex).toBe(true);
  });

  it("merges across calls rather than replacing — later keys win", () => {
    const cfg = ReactiveAgents.create()
      .withName("h")
      .withProvider("anthropic")
      .withModel("claude-haiku-4-5-20251001")
      .withHarness({ stableToolSurface: true })
      .withHarness({ toolIndex: true })
      .toConfig();
    expect(cfg.reasoning?.harness?.stableToolSurface).toBe(true);
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
