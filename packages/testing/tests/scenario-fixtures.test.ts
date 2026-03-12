import { describe, test, expect } from "bun:test";
import {
  createGuardrailBlockScenario,
  createBudgetExhaustedScenario,
  createMaxIterationsScenario,
} from "../src/fixtures/scenarios";

describe("Scenario fixtures", () => {
  test("createGuardrailBlockScenario returns config and expected error tag", () => {
    const scenario = createGuardrailBlockScenario();
    expect(scenario.config).toBeDefined();
    expect(scenario.expectedErrorTag).toBe("ViolationError");
    expect(scenario.triggerInput).toBeTruthy();
  });

  test("createBudgetExhaustedScenario returns config with tight budget", () => {
    const scenario = createBudgetExhaustedScenario();
    expect(scenario.config).toBeDefined();
    expect(scenario.expectedErrorTag).toBe("BudgetExceededError");
    expect(scenario.config.budget).toBeDefined();
  });

  test("createMaxIterationsScenario returns config with low max iterations", () => {
    const scenario = createMaxIterationsScenario();
    expect(scenario.config).toBeDefined();
    expect(scenario.expectedErrorTag).toBe("MaxIterationsError");
    expect(scenario.config.maxIterations).toBeLessThan(5);
  });

  test("each scenario includes a description", () => {
    const scenarios = [
      createGuardrailBlockScenario(),
      createBudgetExhaustedScenario(),
      createMaxIterationsScenario(),
    ];
    for (const s of scenarios) {
      expect(s.description).toBeTruthy();
      expect(typeof s.description).toBe("string");
    }
  });

  test("each scenario config has a provider field", () => {
    const scenarios = [
      createGuardrailBlockScenario(),
      createBudgetExhaustedScenario(),
      createMaxIterationsScenario(),
    ];
    for (const s of scenarios) {
      expect(typeof s.config.provider).toBe("string");
    }
  });
});
