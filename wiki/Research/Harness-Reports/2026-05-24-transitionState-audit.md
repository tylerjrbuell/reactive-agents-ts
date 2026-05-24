---
date: 2026-05-24
issue: GH #114
phase: 1
type: audit
status: complete
related:
  - "[[2026-05-23-harness-convergence]]"
  - "[[Hot]]"
---

# transitionState() Discipline Audit — Phase 1 (GH #114)

## Executive summary

**Zero source-level direct mutations of `state.status` / `state.terminatedBy` / `state.error` exist in the current codebase.** Every state transition is already routed through `transitionState(state, patch)` in `packages/reasoning/src/kernel/state/kernel-state.ts`.

| Metric | Value |
|---|---|
| Memory claim | 170 mutation sites |
| Task prompt claim | 26 mutation sites |
| Empirical count (2026-05-24) | **0** mutation sites |
| Comment-only references | 1 |
| ESLint warnings (warn-level) on `main` | 0 |
| Phase 2 retrofit work required | **None** |

The 170/26 figures reflect prior states of the tree. The W4/W23/W24/W25 decomposition waves (Apr 26 → May 9 2026) already routed all status/error/terminatedBy writes through `transitionState()`. The lint rule installed in this phase is therefore a **regression net** rather than a work queue — its job is to prevent re-introduction of direct mutations as new code lands.

## Reconciliation: why the count is 0

### Type-system enforcement (primary)

`KernelState` declares the relevant fields as `readonly` at the type level:

```ts
// packages/reasoning/src/kernel/state/kernel-state.ts:307-309
readonly status: KernelStatus;
readonly output: string | null;
readonly error: string | null;
```

`terminatedBy` lives on `KernelMeta` (also `readonly`). Any direct `state.status = ...` assignment in source would be a TypeScript compile error today. `transitionState()` itself (line 766) uses a spread (`{ ...state, ...patch }`) to produce a new object — it never mutates in place, so even the canonical mutator stays within the immutable contract.

### Discriminating grep checks (verification)

Run on `main` 2026-05-24, all four queries returned zero source-level hits:

```bash
# 1. Task-prompt query (post-filtered to remove `===` matches)
rtk grep -rnE 'state\.(status|terminatedBy|error)\s*=[^=]' packages apps \
  | grep -v 'test\|dist\|svelte-kit\|node_modules'
# → 1 hit: comment in arbitrator.ts:420 (historical reference)

# 2. Destructure / alias patterns
rtk grep -rnE '\b(status|terminatedBy|error)\s*=\s*"(done|failed|thinking|acting|completed|aborted)"' \
  packages apps --include='*.ts'
# → only step.status (plan-execute step objects, not KernelState) and
#   svelte/db UI mutations (separate domain)

# 3. Bracket-access mutations
rtk grep -rnE 'state\[["\x27](status|terminatedBy|error)["\x27]\]' packages apps --include='*.ts'
# → 0 hits

# 4. ESLint no-restricted-syntax check (AST-level)
bunx eslint 'packages/**/*.ts' 'apps/**/*.ts'
# → 0 warnings from the new rule
```

## Inventory

### Direct `state.{status|terminatedBy|error}` assignments

| file | line | mutation | needs retrofit? | notes |
|---|---|---|---|---|
| _(none)_ | — | — | — | All `KernelState` writes flow through `transitionState()` (functional update). `readonly` field declarations prevent direct assignment at compile time. |

### Comment-only references (no retrofit needed)

| file | line | reference | notes |
|---|---|---|---|
| `packages/reasoning/src/kernel/capabilities/decide/arbitrator.ts` | 420 | `// that previously transitioned state.status="done" now flows through here.` | Historical commentary explaining the Sprint-3.3 consolidation; intentional. |

### Adjacent — non-`KernelState` mutations (NOT in scope)

These appear in unfiltered greps but mutate different objects (plan-execute step records, Svelte UI state, SQL row builders). They are explicitly out of scope for GH #114 and the lint rule does not flag them (selector is keyed on the identifier `state`).

| file | line | mutation | scope |
|---|---|---|---|
| `packages/reasoning/src/strategies/plan-execute.ts` | 442, 511, 523 | `step.status = "in_progress" \| "completed" \| "failed"` | Plan-execute `Step` records, separate from `KernelState`. |
| `packages/svelte/src/agent-stream.ts` | 81 | `next.status = "completed"` | UI store update, not `KernelState`. |
| `apps/cortex/server/db/queries.ts` | 387 | `status = "failed"` | Local SQL row-builder variable. |

### Canonical mutation sites (rule disabled)

| file | role |
|---|---|
| `packages/reasoning/src/kernel/state/kernel-state.ts` | Defines `transitionState()` (line 766). Sole producer of new `KernelState` snapshots. |
| `packages/reasoning/src/kernel/loop/terminate.ts` | Termination helper (FIX-18 / Stage 5 W4); composes terminal patches and hands them to `transitionState()`. No direct field writes. |

## ESLint rule scaffold (this phase)

Added `eslint.config.mjs` at repo root with a single `no-restricted-syntax` selector:

```js
// AST selector
"AssignmentExpression[left.type='MemberExpression']" +
"[left.object.name='state']" +
"[left.property.name=/^(status|terminatedBy|error)$/]"
```

- **Severity:** `warn` (phase 1) — flips to `error` in phase 2 when the audit + retrofit work queue is closed.
- **Override:** rule disabled for the two canonical files (`kernel-state.ts`, `terminate.ts`).
- **Parser:** `@typescript-eslint/parser` (8.59.4) for TS AST.
- **Plugin stub:** no-op `@typescript-eslint` plugin registers placeholders for `no-explicit-any` / `no-require-imports` / `no-implied-eval` so pre-existing inline disable directives don't error.

### Verification evidence

| Scenario | Filename | Result | Expected |
|---|---|---|---|
| Direct violation in normal package file | `packages/runtime/src/_fixture.ts` (stdin) | 3 warnings | 3 warnings ✓ |
| Direct violation in canonical `kernel-state.ts` | stdin | 0 warnings | 0 warnings ✓ |
| Direct violation in canonical `terminate.ts` | stdin | 0 warnings | 0 warnings ✓ |
| Full repo lint on `main` | `packages/**/*.ts` + `apps/**/*.ts` | 0 warnings | 0 warnings ✓ |

`bunx eslint --print-config <file>` confirms rule severity is `0` (off) for the two canonical paths and `1` (warn) elsewhere — single source of truth for the override.

## Phase 2 implications

Because the empirical count is zero, **no source retrofit is required**. Phase 2 of GH #114 collapses to a one-line change:

```diff
-      "no-restricted-syntax": ["warn", NO_DIRECT_STATE_MUTATION],
+      "no-restricted-syntax": ["error", NO_DIRECT_STATE_MUTATION],
```

Gating signal for the flip: one CI run on `main` (or the integrating PR) showing zero warnings of this rule. The current state of `main` already satisfies that gate.

## Open items

- **None for phase 1.** The lint rule is the regression net; the audit confirms the tree is already clean.
- **Phase 2 follow-ups (out of scope here):**
  - Wire `bun run lint` into CI (currently linter is only invoked manually).
  - Consider expanding the rule to other immutable-only fields on `KernelState` (`steps`, `iteration`, `tokens`, `cost`) — Phase 2+ design decision.
  - Reintroduce `@typescript-eslint/eslint-plugin` properly so the stub plugin can be deleted (cosmetic).

## Files touched

- **NEW:** `eslint.config.mjs` (flat config, root)
- **NEW:** `wiki/Research/Harness-Reports/2026-05-24-transitionState-audit.md` (this file)
- **MODIFIED:** `package.json` devDeps (`eslint`, `@typescript-eslint/parser` added; `bun.lock` regenerated)
- **NO PACKAGES SOURCE CHANGES** (per phase 1 authority bounds).
