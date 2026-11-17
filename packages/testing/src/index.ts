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
 * @unstable Few runtime test consumers; the surface may change in any release.
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
 * @unstable Few runtime test consumers; the surface may change in any release.
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
 * @unstable The gate runs in CI (`bun run gate:check`) but its baseline and
 * runner API are still settling and may change in any release.
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

// ─── Typed test doubles (no double casts) ───
/** Typed `fetch` stub: `stubFetch(handler)` returns a real `typeof globalThis.fetch`. */
export { stubFetch, type FetchHandler } from "./doubles/fetch.js";
/** Capturing `NodeJS.WriteStream` double backed by a real `net.Socket` subclass. */
export {
  fakeWriteStream,
  type FakeWriteStream,
  type FakeWriteStreamOptions,
} from "./doubles/write-stream.js";
/** Real `Response` builders (JSON, text, SSE). */
export { jsonResponse, textResponse, sseResponse } from "./doubles/response.js";
