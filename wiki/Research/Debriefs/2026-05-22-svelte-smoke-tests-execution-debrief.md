# Execution Retro: svelte-smoke-tests

Date: 2026-05-22
Budget: 30 min | Actual: ~20 min

## Outcomes

- Issues partially closed: #82 (HS-26) — svelte portion; vue portion remains as `bundle/vue-smoke-tests`
- Net test delta: +13 / 0 (packages/svelte: 0 → 13 tests, file count: 0 → 1)
- Net LOC delta: +295 (test + plan)
- Verified-by recheck: `find packages/svelte -name '*.test.ts*'` → 1 (was 0)

## What worked

- **Behavioral over export-only because the substrate allowed it.** Svelte stores are pure JS — `writable` works in any runtime, no DOM. Skipped the export-presence-only ceiling that constrained the react bundle and got 9 behavioral cases for free.
- **Native `Response`/`fetch` mocking is a one-liner per case.** No mocking library needed; `globalThis.fetch = async () => new Response(...)` covers both JSON and SSE bodies. The SSE-stream test passes a multi-event body as a single string and the existing parser handles `\n`-split lines + `data: ` prefix correctly.
- **PR cross-link to companion bundle.** PR #101 references PR #100 (react portion) in the description. Reviewers see the full #82 closeout in two PRs without needing to chase issue comments.

## What didn't

- **Initial test for `cancel()` had a subtle race risk.** First draft called `cancel()` after `run()` was in-flight — but `run()` is async fire-and-forget (returns nothing), so capturing the cancellation transition was timing-dependent. Resolved by testing `cancel()` from idle state instead (it still flips `status` to `'idle'` defensively, even when no fetch is in flight, per the impl at `agent-stream.ts:38`). Coverage of `cancel()` mid-stream stays available for a follow-up.
- **SSE happy-path only.** Did not exercise the chunked-buffer path where SSE deltas split across read boundaries. The current impl handles it via `buffer = lines.pop() ?? ""` — would need a stream that yields multiple chunks to test, not the single-`Response` body I used. Worth a follow-up if SSE issues surface, but pinning the basic contract is the higher-value first step.

## Skill improvements (apply on next pass)

1. **Phase 3 PLAN: codify "substrate-aware test strategy" as a checklist item.** When adding tests to a new framework/package, the first question is "does the substrate require a render context?" For React/Vue (render-bound), behavioral coverage is gated on test-infra investment. For Svelte stores / pure factory functions / Effect.Effect chains, behavioral coverage is free. Add to the PLAN section: *"Identify the test substrate: render-bound (React render context, Vue setup), framework-agnostic (Svelte store, plain JS factory), or pure (Effect/function). For framework-agnostic + pure, default to behavioral coverage; for render-bound, default to public-surface smoke + named follow-up bundle for behavioral via @testing-library/X."* Documents the cap that drove the react bundle's smaller scope vs svelte's stronger coverage.

## Process inflation guard (HS-18/22/31 lesson)

- Was the verified-by inflated? **No.** Same clean evidence as react bundle. Audit grep matched current state.
- Document the inflation shape: **none**.
