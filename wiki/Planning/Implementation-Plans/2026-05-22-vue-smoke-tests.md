# Bundle: vue-smoke-tests

Date: 2026-05-22
Budget: 30 min
Issues: #82 (HS-26) — vue portion (completes #82 with PRs #100 + #101)

## Acceptance criteria

- **#82 (vue portion):** `packages/vue/` ships ≥1 `*.test.ts`. `find packages/vue -name '*.test.ts'` returns ≥1 (was 0).
- Bug surfaced during test authoring: `StreamError` event in `useAgentStream` was silently swallowed (throw inside loop caught by inner try/catch). Fixed.

## Cross-package descope

Final partition of #82 (third bundle).

## Test-strategy decision

Vue Composition API `ref()` from `vue/reactivity` works outside `setup()` scope — same framework-agnostic substrate as svelte stores (skill v8). Behavioral coverage is the default tier.

## Execution units

1. **Unit 1 — `packages/vue/tests/smoke.test.ts`.** 12 cases:
   - 3 public-surface
   - 4 `useAgent` behavioral (refs shape, loading→output, error path, `data.result` fallback)
   - 5 `useAgentStream` behavioral (refs shape, SSE deltas+complete, SSE error, HTTP error, cancel→idle)
2. **Unit 2 — fix `useAgentStream` StreamError swallow.** Mirror svelte impl: direct `error.value`/`status.value` assignment instead of throwing (which was caught + swallowed by the inner `try{JSON.parse}catch` block).

## Verification protocol

- `rtk bun test packages/vue/` → 12 pass / 0 fail
- `rtk bun run typecheck` (packages/vue) → clean
- `rtk bunx turbo run build` → 38/38
- Verified-by recheck: `find packages/vue -name '*.test.ts*'` → 1 (was 0)

## Out of scope (explicit)

- E2E inside a Vue component runtime — not needed; refs are reactivity-only, no `setup()` dependency
- Chunked-buffer SSE fuzz — same scope as svelte bundle's deferral
- Behavioral coverage equivalent for `packages/react/` — blocked by render context, follow-up `bundle/react-behavioral-tests`

## Baseline (pre-EXECUTE)

- `find packages/vue -name '*.test.ts*'` → 0 results
- Workspace test (root, prior session): 5334/0/26-skip with intermittent pre-existing flakes
- Vue package isolated: no tests, no test script

## Adjacent improvement found

`packages/vue/src/use-agent-stream.ts:76-78` — `StreamError` branch threw inside the JSON.parse try/catch. Inner catch swallowed it. Result: any SSE `StreamError` event in vue UIs was silently dropped — `status` stayed `streaming`, `error` stayed `null`, never recovered. Fixed by mirroring the svelte pattern (`error.value = ...; status.value = "error"; return;`).
