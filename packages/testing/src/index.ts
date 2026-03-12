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
