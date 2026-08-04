# Bundle: react-smoke-tests

Date: 2026-05-22
Budget: 30 min
Issues: #82 (HS-26) — react portion only

## Acceptance criteria

- **#82 (react portion):** `packages/react/` ships at least one `*.test.ts` file exercising the public surface. `find packages/react -name '*.test.ts'` returns ≥1 (was 0).

## Cross-package descope

Issue #82 cites three packages: `packages/react/`, `packages/svelte/`, `packages/vue/`. Per Phase 2 hard gate (cross-package descope), restrict bundle to **react only**. `svelte` + `vue` ship as follow-up per-package bundles (`bundle/svelte-smoke-tests`, `bundle/vue-smoke-tests`). Each gets its own PR.

## Test-strategy decision

React hooks (`useState` / `useCallback`) throw "Invalid hook call" outside a render context. Three viable approaches:

1. **Full render via `@testing-library/react` + `happy-dom`** — true behavioral coverage but adds 2 dev deps + setup for one smoke test → scope creep.
2. **Pure-function extraction** — refactor fetch/SSE logic out of the hooks into pure helpers, test those — best long-term but expands bundle scope past "add tests".
3. **Public-surface smoke** — assert named exports exist, function arity, type-contract for `AgentStreamEvent._tag` variants and `AgentHookState` union — true smoke (zero deps, fast).

Pick (3) for this bundle. Hardening via (1) or (2) → follow-up bundle.

The `AgentStreamEvent._tag` contract IS load-bearing: the hook's SSE parser switches on `_tag` strings. If the runtime's `AgentStream` emission renames a variant (e.g., `StreamCompleted` → `Completed`), the hook silently misses events. The type-contract assertion catches that at compile time even though it doesn't execute the hook.

## Execution units

1. **Unit 1 — `packages/react/tests/smoke.test.ts`.** 6 cases:
   - `useAgent` exported as function, arity ≥1
   - `useAgentStream` exported as function, arity ≥1
   - `AgentHookState` union covers `idle` / `streaming` / `completed` / `error`
   - `AgentStreamEvent._tag` covers `TextDelta` / `StreamCompleted` / `StreamCancelled` / `StreamError`
   - `UseAgentReturn` shape reachable at compile time
   - `UseAgentStreamReturn` shape reachable at compile time

## Verification protocol

- `rtk bun test packages/react/` → 6 pass / 0 fail
- `rtk bunx turbo run typecheck --filter=@reactive-agents/react` → no new errors
- `rtk bunx turbo run build` → 38/38
- Verified-by recheck: `find packages/react -name '*.test.ts*'` → 1 result (was 0)

## Out of scope (explicit)

- `packages/svelte/` smoke tests — follow-up bundle `bundle/svelte-smoke-tests`
- `packages/vue/` smoke tests — follow-up bundle `bundle/vue-smoke-tests`
- Behavioral coverage of the hooks via React render — follow-up bundle `bundle/react-behavioral-tests` once test-infra investment is justified
- Extracting fetch/SSE logic into pure helpers — refactor, separate from #82's "add tests" scope

## Baseline (pre-EXECUTE)

- `find packages/react -name '*.test.ts*'` → 0 results
- Workspace test (root): baseline at prior session ~5334/0/26-skip; current run shows a separate `packages/diagnose/` test-order flake (workspace mode only; 35/0 in isolation) — pre-existing, not blocking this bundle.
