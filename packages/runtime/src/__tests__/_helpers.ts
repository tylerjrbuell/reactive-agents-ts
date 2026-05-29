/**
 * Shared test helpers for the runtime package's `__tests__/` suites.
 *
 * Re-exports the production `asBuilderState` helper from
 * `builder/withers/_state.ts` (WS-6 Phase 1) so tests and production wither
 * helpers share a single concentrated `as unknown as` cast site. The
 * production helper widens to a SUPERSET `BuilderState` view that covers
 * every private field touched by wither bodies — broader than the prior
 * `BuilderRuntimeStateView` (which models the runtime-construction read
 * path). Tests asserting on `_xyz` fields get the same guarantees: a passing
 * assertion lands on a field the production code path mutates / reads.
 *
 * See `packages/runtime/test/as-unknown-as-ceiling.test.ts` for the
 * anti-regression ceiling this concentration feeds into.
 */
export { asBuilderState } from "../builder/withers/_state.js";
