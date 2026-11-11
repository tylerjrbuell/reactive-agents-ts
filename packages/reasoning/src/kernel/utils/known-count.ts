/**
 * Token-half aggregation (TokenUsage `inputTokens` / `outputTokens` are
 * optional: an absent half means the provider did not split its count).
 *
 * One rule for every aggregate in the reasoning package: totals stay numbers;
 * a half is summed only while every contribution knew it, and becomes
 * `undefined` once any contributing call left it unknown. Summing an absent
 * half as 0 would present an unmeasured figure as measured. Budget and meter
 * decisions read totals, never halves. Mirrors `addCount` in
 * `@reactive-agents/llm-provider` (structured-parse-retry.ts).
 */

/**
 * Sum two token counts, unknown when either side is unknown.
 *
 * @param a - Running count (or `undefined` when already unknown).
 * @param b - The next contribution (or `undefined` when the call did not report it).
 * @returns `a + b`, or `undefined` when either is `undefined`.
 */
export const addKnown = (a: number | undefined, b: number | undefined): number | undefined =>
  a === undefined || b === undefined ? undefined : a + b;

/**
 * One contribution's half, for {@link addKnown}: the reported half when there
 * is one; otherwise 0 when the contribution spent no tokens (nothing to split,
 * e.g. a no-op accounting step), else `undefined` (spent, but unsplit).
 *
 * @param half - The half the contribution reported, if any.
 * @param tokens - The contribution's total tokens.
 */
export const contributedHalf = (half: number | undefined, tokens: number | undefined): number | undefined =>
  half ?? ((tokens ?? 0) === 0 ? 0 : undefined);
