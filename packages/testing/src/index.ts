// ─── Types ───
export type { MockLLMRule, CapturedEvent, CapturedToolCall } from "./types.js";

// ─── Errors ───
export { MockError } from "./errors.js";

// ─── Mock Services ───
export { createMockLLM, createMockLLMFromMap, createTestLLMServiceLayer } from "./mocks/llm.js";
export type { LLMCall } from "./mocks/llm.js";
export { createMockToolService } from "./mocks/tools.js";
export { createMockEventBus } from "./mocks/event-bus.js";

// ─── Helpers ───
export {
  assertToolCalled,
  assertStepCount,
  assertCostUnder,
} from "./helpers/assertions.js";
export { createTestLLM } from "./helpers/agent.js";

// ─── Stream Assertions ───
export { expectStream } from "./assertions/stream.js";
export type { StreamExpectation } from "./assertions/stream.js";

// ─── Scenario Fixtures ───
export {
  createGuardrailBlockScenario,
  createBudgetExhaustedScenario,
  createMaxIterationsScenario,
} from "./fixtures/scenarios.js";
export type { ScenarioFixture } from "./fixtures/scenarios.js";

// ─── Trace Assertions ───
export { expectTrace } from "./harness/expect-trace.js";

// ─── Scenario Runner ───
export { runScenario, runCounterfactual } from "./harness/scenario.js";
export type {
  ScenarioConfig,
  ScenarioResult,
  CounterfactualResult,
} from "./harness/scenario.js";

// ─── North Star Test Gate (Tier 1) ───
export {
  runGate,
  captureOutcome,
  diffOutcomes,
  formatFailure,
  archiveFailingTrace,
  readBaseline,
  writeBaseline,
  readHealth,
  writeHealth,
  bumpHealth,
  REPORTS_DIR,
  BASELINE_PATH,
  HEALTH_PATH,
  REGRESSIONS_DIR,
} from "./gate/runner.js";
export type {
  Tier1Baseline,
  Tier1ScenarioOutcome,
  ScenarioModule,
  ScenarioDiff,
  FieldDiff,
  ScenarioHealth,
  ScenarioHealthEntry,
} from "./gate/types.js";
export { discoverScenarios, summarizeCoverage } from "./gate/registry.js";
