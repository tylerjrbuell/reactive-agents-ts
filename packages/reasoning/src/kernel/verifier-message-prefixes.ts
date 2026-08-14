/**
 * Verifier rejection/escalation error message prefixes.
 *
 * These prefixes are used by the kernel's verifier (runner.ts) to compose error
 * messages and by the runtime's result-boundary verifier (execution-engine.ts)
 * to extract the rejection reason. Sharing these constants prevents string-coupling
 * and ensures that renames break the build (not silently regress receipts).
 *
 * FM-4 part 2 (2026-08-14): durability fix for verifier reason extraction.
 */

export const VERIFIER_REJECTION_PREFIX = "Verifier rejected output: ";
export const VERIFIER_ESCALATION_PREFIX = "Verifier escalated output: ";
