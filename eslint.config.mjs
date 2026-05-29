// ESLint flat config for the Reactive Agents monorepo.
//
// Scope (phase 1): a single AST-level guardrail enforcing the
// transitionState() discipline documented in GH #114.
//
// Rule: direct assignment to `state.status`, `state.error`, or
// `state.terminatedBy` is forbidden outside the two canonical sites:
//   - packages/reasoning/src/kernel/state/kernel-state.ts
//   - packages/reasoning/src/kernel/loop/terminate.ts
//
// All other call sites MUST go through `transitionState(state, patch)` from
// `kernel-state.ts`, which returns a new state object (functional update,
// preserves the immutable contract enforced by `readonly` field declarations
// on `KernelState`).
//
// Severity is "warn" in phase 1 so that any pre-existing violation does not
// block CI on landing. Phase 2 retrofits any flagged sites, then severity
// flips to "error" via a single line edit in this file.

import tsParser from "@typescript-eslint/parser";

// Stub plugin: pre-existing source-level `// eslint-disable-next-line
// @typescript-eslint/<rule>` comments reference rules from a previous tooling
// setup. We register no-op rule definitions for the rules that appear in
// inline disable directives so ESLint doesn't error on "rule not found".
// This is a one-line maintenance burden; replace with the real plugin once
// `@typescript-eslint/eslint-plugin` is reintroduced.
const NOOP_RULE = {
  meta: { type: "problem", schema: [] },
  create: () => ({}),
};
const tsEslintStub = {
  rules: {
    "no-explicit-any": NOOP_RULE,
    "no-require-imports": NOOP_RULE,
    "no-implied-eval": NOOP_RULE,
  },
};

const STATE_MUTATION_SELECTOR =
  "AssignmentExpression[left.type='MemberExpression']" +
  "[left.object.name='state']" +
  "[left.property.name=/^(status|terminatedBy|error)$/]";

const NO_DIRECT_STATE_MUTATION = {
  selector: STATE_MUTATION_SELECTOR,
  message:
    "Direct mutation of state.{status,terminatedBy,error} is forbidden. " +
    "Route the update through transitionState(state, patch) from " +
    "packages/reasoning/src/kernel/state/kernel-state.ts. " +
    "See GH #114 (transitionState discipline).",
};

// WS-3 Phase 4b — Capability boundary rule (leaf principle, architecture model §2.3).
//
// Files under `kernel/capabilities/<cap>/` MAY NOT import from sibling
// capability directories. Cross-capability dependencies must route through:
//   - `kernel/utils/` (substrate primitives — pure helpers)
//   - `kernel/state/` (shared state types)
//   - `core/services/` Tag-based service contracts
//
// Restored cycles after WS-3 Phase 1+2+3+4a: ZERO (verified 2026-05-28).
// This rule structurally prevents re-introduction.
//
// Severity warn → error flip after retrofitting any pre-existing flagged
// sites (currently expected: zero, but pre-existing edges may surface).
// Match `from "../<cap>/...js"` — esquery doesn't support regex alternation
// groups, so the selector is the broader `^\.\./[a-z]+\/` pattern. This
// catches all cross-directory ../X/ imports from within a capability dir.
// Inside kernel/capabilities/<cap>/ files, the only "../<X>/" path that's
// legitimate is `../<same-cap>/` (rare same-dir-via-parent pattern); all
// other matches are cross-capability internal imports.
const NO_CROSS_CAPABILITY_INTERNAL_IMPORT = {
  selector:
    "ImportDeclaration[source.value=/^\\.\\.\\/[a-z]+\\//]",
  message:
    "Cross-capability internal import. The leaf principle (architecture-model §2.3) " +
    "says capabilities consume substrate, NOT each other. Route through " +
    "kernel/utils/ (pure helpers), kernel/state/ (shared types), or a " +
    "Tag-based service contract in core/services/. " +
    "Allowed baseline (~23 pre-existing edges, all one-way; zero cycles as of WS-3 Phase 4a) " +
    "tolerated via warn-level; new violations should be reviewed.",
};

export default [
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.turbo/**",
      "**/.svelte-kit/**",
      "**/.reactive-agents/**",
      "**/*.d.ts",
      // Build artifacts and generated output
      "apps/cortex/ui/.svelte-kit/**",
      "apps/docs/.astro/**",
    ],
  },
  {
    files: ["packages/**/*.ts", "apps/**/*.ts"],
    plugins: {
      "@typescript-eslint": tsEslintStub,
    },
    languageOptions: {
      parser: tsParser,
      ecmaVersion: "latest",
      sourceType: "module",
    },
    linterOptions: {
      // Pre-existing source-level eslint-disable comments reference plugin
      // rules (e.g. @typescript-eslint/*) that this minimal config does not
      // load. Don't flag those as unused — they were valid under the previous
      // tooling and will resolve once the relevant plugins are reintroduced.
      reportUnusedDisableDirectives: false,
    },
    rules: {
      // WS-3 Phase 4c (2026-05-29): severity flipped warn → error after
      // Sprint 3.3 + prior transitionState retrofit confirmed zero raw
      // state.{status,terminatedBy,error} = sites outside canonical owners.
      // Gate: packages/reasoning/tests/kernel-state-mutation-discipline.test.ts.
      "no-restricted-syntax": ["error", NO_DIRECT_STATE_MUTATION],
    },
  },
  // Canonical mutation sites — turn the rule OFF here. These two files are
  // the single owners of state.status / state.error / state.terminatedBy
  // assignment semantics.
  {
    files: [
      "packages/reasoning/src/kernel/state/kernel-state.ts",
      "packages/reasoning/src/kernel/loop/terminate.ts",
    ],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
  // WS-3 Phase 4b — Capability boundary rule. Applies ONLY under
  // packages/reasoning/src/kernel/capabilities/*/. Each capability dir is a
  // leaf — no sibling capability internal imports.
  //
  // Severity is "warn": the rule has its own retrofit baseline (~23 pre-existing
  // one-way edges, zero cycles as of WS-3 Phase 4a) which is tolerated until a
  // dedicated boundary-relocation phase retires the residual edges. New
  // cross-cap imports surface as warnings during review.
  //
  // NOTE: this block carries ONLY the cross-cap selector. State-mutation
  // enforcement at error severity is provided by the trailing block below.
  // (`no-restricted-syntax` is a single-severity rule and flat-config rule
  // settings are REPLACED — not merged — by later matching blocks; mixing
  // selectors at different severities therefore requires the split.)
  {
    files: ["packages/reasoning/src/kernel/capabilities/**/*.ts"],
    rules: {
      "no-restricted-syntax": ["warn", NO_CROSS_CAPABILITY_INTERNAL_IMPORT],
    },
  },
  // WS-3 Phase 4c (2026-05-29) — Severity lock-in for NO_DIRECT_STATE_MUTATION
  // across the whole kernel/ tree, including capabilities/, where the
  // preceding Phase 4b block would otherwise have dropped the state-mutation
  // selector entirely.
  //
  // Excludes the two canonical mutation owners (kernel-state.ts +
  // terminate.ts) — their existing "off" override above remains the
  // structural source of truth for those files.
  {
    files: ["packages/reasoning/src/kernel/**/*.ts"],
    ignores: [
      "packages/reasoning/src/kernel/state/kernel-state.ts",
      "packages/reasoning/src/kernel/loop/terminate.ts",
    ],
    rules: {
      "no-restricted-syntax": ["error", NO_DIRECT_STATE_MUTATION],
    },
  },
];
