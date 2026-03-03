import { createMockLLMFromMap } from "../mocks/llm.js";

/**
 * Convenience wrapper to create a test LLM from a simple response map.
 * Alias for `createMockLLMFromMap`.
 */
export function createTestLLM(responses: Record<string, string>) {
  return createMockLLMFromMap(responses);
}
