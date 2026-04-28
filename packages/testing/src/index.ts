// ─── Types ───
export type { MockLLMRule, CapturedEvent, CapturedToolCall } from "./types.js";

// ─── Errors ───
export { MockError } from "./errors.js";

// ─── Mock Services (stable) ───
// Mocks are exercised by ~all in-repo tests; surface is stable.
export { createMockLLM, createMockLLMFromMap, createTestLLMServiceLayer } from "./mocks/llm.js";
export type { LLMCall } from "./mocks/llm.js";
export { createMockToolService } from "./mocks/tools.js";
export { createMockEventBus } from "./mocks/event-bus.js";

// ─── Helpers (stable) ───
export {
  assertToolCalled,
  assertStepCount,
  assertCostUnder,
} from "./helpers/assertions.js";
export { createTestLLM } from "./helpers/agent.js";

/**
 * ─── Stream Assertions ───
 * Helpers for asserting against streamed `StreamEvent` sequences.
 *
 * @unstable Limited (≤2) runtime test consumers; AUDIT verdict for testing is
 * SHRINK. May change in v0.10.x.
 * See AUDIT-overhaul-2026.md §10.1 (testing SHRINK) and §11 #40.
 */
export { expectStream } from "./assertions/stream.js";
export type { StreamExpectation } from "./assertions/stream.js";

// ─── Scenario Fixtures (stable) ───
// Exercised by gate scenarios + several runtime tests.
export {
  createGuardrailBlockScenario,
  createBudgetExhaustedScenario,
  createMaxIterationsScenario,
} from "./fixtures/scenarios.js";
export type { ScenarioFixture } from "./fixtures/scenarios.js";

// ─── Trace Assertions ───
export { expectTrace } from "./harness/expect-trace.js";

/**
 * ─── Scenario Runner ───
 * `runScenario` / `runCounterfactual` — declarative scenario execution and
 * counterfactual replay against the harness.
 *
 * @unstable Limited (≤2) runtime test consumers; AUDIT verdict for testing is
 * SHRINK. May change in v0.10.x.
 * See AUDIT-overhaul-2026.md §10.1 (testing SHRINK) and §11 #40.
 */
export { runScenario, runCounterfactual } from "./harness/scenario.js";
export type {
  ScenarioConfig,
  ScenarioResult,
  CounterfactualResult,
} from "./harness/scenario.js";

/**
 * ─── North Star Test Gate (Tier 1) ───
 * Tier-1 deterministic scenario gate: capture/diff outcomes vs a recorded
 * baseline, scenario discovery, health (flake-rate) bookkeeping.
 *
 * @unstable Tier-1 Gate has zero CI invocations; mark unstable until at least
 * one CI run produces a baseline diff. AUDIT verdict for testing is SHRINK.
 * See AUDIT-overhaul-2026.md §10.1 (testing SHRINK) and §11 #40.
 */
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
/**
 * Gate scenario discovery + coverage summarization.
 * @unstable See North Star Test Gate (Tier 1) section above.
 */
export { discoverScenarios, summarizeCoverage } from "./gate/registry.js";
