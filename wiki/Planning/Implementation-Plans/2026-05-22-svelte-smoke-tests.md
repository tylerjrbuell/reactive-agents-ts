# Bundle: svelte-smoke-tests

Date: 2026-05-22
Budget: 30 min
Issues: #82 (HS-26) — svelte portion only

## Acceptance criteria

- **#82 (svelte portion):** `packages/svelte/` ships at least one `*.test.ts` file. `find packages/svelte -name '*.test.ts'` returns ≥1 (was 0).

## Cross-package descope

Same as react bundle (`bundle/react-smoke-tests`, PR #100). Vue portion ships next as `bundle/vue-smoke-tests`.

## Test-strategy decision

Svelte stores (`writable` from `svelte/store`) are pure JS — work in any runtime, no render context required. **Behavioral coverage available without test-infra investment.** Three categories of tests:

1. **Public-surface smoke** — export presence, type contracts for `AgentStreamEvent._tag` and `AgentHookState` (parity with react bundle for SSE contract drift detection).
2. **`createAgent` behavioral** — store initial shape, loading/success/error state transitions via mocked `fetch`.
3. **`createAgentStream` behavioral** — store initial shape, SSE parsing (TextDelta accumulation, StreamCompleted, StreamError), `cancel()` → idle.

This is meaningfully stronger than the react bundle (which capped at smoke due to "Invalid hook call" outside render). Svelte's pure-function factory makes behavioral coverage cheap — no excuse to skip it.

## Execution units

1. **Unit 1 — `packages/svelte/tests/smoke.test.ts`.** 13 cases:
   - 4 public-surface
   - 4 `createAgent` (returns shape, idle init, success path, error path)
   - 5 `createAgentStream` (returns shape, idle init, SSE delta+complete, SSE error, cancel)

## Verification protocol

- `rtk bun test packages/svelte/` → 13 pass / 0 fail
- `rtk bun run typecheck` (in packages/svelte) → clean
- `rtk bunx turbo run build` → 38/38
- Verified-by recheck: `find packages/svelte -name '*.test.ts*'` → 1 result (was 0)

## Out of scope (explicit)

- `packages/vue/` smoke tests — follow-up bundle `bundle/vue-smoke-tests`
- E2E test inside an actual Svelte component runtime — not needed; stores are framework-agnostic
- Stress/edge SSE parsing (chunked deltas split across buffer boundaries) — current tests cover the happy path; chunked-buffer fuzz is a separate concern

## Baseline (pre-EXECUTE)

- `find packages/svelte -name '*.test.ts*'` → 0 results
- Workspace test (root, prior session): 5334/0/26-skip (with intermittent diagnose flake — pre-existing)
- Svelte package isolated: no tests, no test script
