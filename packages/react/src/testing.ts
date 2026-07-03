/**
 * @reactive-agents/react/testing — re-export of ui-core's fixture testing API
 * so React consumers can import test helpers from one place, without a direct
 * dependency on `@reactive-agents/ui-core/testing` in their test files.
 */
export { recordRunFixture, mockAgentEndpoint, fixtureToSSE, type RunFixture } from "@reactive-agents/ui-core/testing";
