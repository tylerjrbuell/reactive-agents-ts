/**
 * Shared test helpers for the runtime package's `__tests__/` suites.
 *
 * Concentrates type-widening casts so individual test files don't litter the
 * codebase with inline `(builder as unknown as BuilderRuntimeStateView)` calls.
 *
 * See `packages/runtime/test/as-unknown-as-ceiling.test.ts` for the
 * anti-regression ceiling that this helper file feeds into.
 */
import type { ReactiveAgentBuilder } from "../builder.js";
import type { BuilderRuntimeStateView } from "../builder/build-effect/runtime-construction.js";

/**
 * Cast a `ReactiveAgentBuilder` to its private-field view for assertions.
 *
 * The builder's `_xyz` fields are marked private in the public type, but the
 * production runtime construction path reads them through
 * `BuilderRuntimeStateView`. Tests assert against the same view so that a
 * passing assertion guarantees the field lands in the production read path.
 *
 * This is the single concentrated `as unknown as` cast for builder-state
 * test access — duplicating it inline in test bodies adds count to the §5.5
 * ceiling without adding signal.
 */
export const asBuilderState = (
  builder: ReactiveAgentBuilder,
): BuilderRuntimeStateView =>
  builder as unknown as BuilderRuntimeStateView;
