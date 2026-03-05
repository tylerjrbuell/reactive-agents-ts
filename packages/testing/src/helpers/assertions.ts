import type { CapturedToolCall } from "../types.js";

/**
 * Assert that a tool was called, with optional count checks.
 *
 * @param calls - Array of captured tool calls
 * @param toolName - The tool name to check
 * @param options - Optional bounds: `times` (exact), `min`, `max`
 * @throws Error if assertion fails
 */
export function assertToolCalled(
  calls: readonly CapturedToolCall[],
  toolName: string,
  options?: { times?: number; min?: number; max?: number },
): void {
  const matching = calls.filter((c) => c.toolName === toolName);

  if (matching.length === 0) {
    throw new Error(`Expected tool "${toolName}" to be called, but it was never called`);
  }

  if (options?.times !== undefined && matching.length !== options.times) {
    throw new Error(
      `Expected tool "${toolName}" to be called exactly ${options.times} time(s), but it was called ${matching.length} time(s)`,
    );
  }

  if (options?.min !== undefined && matching.length < options.min) {
    throw new Error(
      `Expected tool "${toolName}" to be called at least ${options.min} time(s), but it was called ${matching.length} time(s)`,
    );
  }

  if (options?.max !== undefined && matching.length > options.max) {
    throw new Error(
      `Expected tool "${toolName}" to be called at most ${options.max} time(s), but it was called ${matching.length} time(s)`,
    );
  }
}

/**
 * Assert that the step count meets the specified bounds.
 *
 * @param steps - The actual step count
 * @param bounds - `exact`, `min`, and/or `max`
 * @throws Error if assertion fails
 */
export function assertStepCount(
  steps: number,
  bounds: { exact?: number; min?: number; max?: number },
): void {
  if (bounds.exact !== undefined && steps !== bounds.exact) {
    throw new Error(
      `Expected exactly ${bounds.exact} step(s), but got ${steps}`,
    );
  }

  if (bounds.min !== undefined && steps < bounds.min) {
    throw new Error(
      `Expected at least ${bounds.min} step(s), but got ${steps}`,
    );
  }

  if (bounds.max !== undefined && steps > bounds.max) {
    throw new Error(
      `Expected at most ${bounds.max} step(s), but got ${steps}`,
    );
  }
}

/**
 * Assert that estimated cost is under a threshold.
 *
 * @param cost - The actual cost in USD
 * @param maxUsd - Maximum acceptable cost in USD
 * @throws Error if cost exceeds threshold
 */
export function assertCostUnder(cost: number, maxUsd: number): void {
  if (cost > maxUsd) {
    throw new Error(
      `Expected cost to be under $${maxUsd}, but got $${cost}`,
    );
  }
}
