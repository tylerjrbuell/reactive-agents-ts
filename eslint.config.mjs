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
      // Phase 1 severity: "warn". Phase 2 flips to "error" once any
      // surviving violations from the audit have been retrofitted.
      "no-restricted-syntax": ["warn", NO_DIRECT_STATE_MUTATION],
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
];
