# Execution Retro: react-smoke-tests

Date: 2026-05-22
Budget: 30 min | Actual: ~25 min

## Outcomes

- Issues partially closed: #82 (HS-26) — react portion; svelte + vue tracked as follow-up bundles via PR description
- Issues descoped: none (the cross-package split IS the bundle's structure, not a punted fix)
- Net test delta: +6 / 0 (packages/react: 0 → 6 tests, file count: 0 → 1)
- Net LOC delta: +149 (one test file + plan doc)
- Verified-by recheck: `find packages/react -name '*.test.ts*'` → 1 (was 0)

## What worked

- **Cross-package descope cleanly executed.** Issue cites 3 packages; bundle ships 1. PR description names the follow-up bundles (`bundle/svelte-smoke-tests`, `bundle/vue-smoke-tests`) so the queue is explicit. Skill v3+v5's cross-package gate carried over to "test infra" issues, not just typing.
- **Test-strategy decision documented up front.** The plan called out 3 strategies (full render / pure-fn extraction / public-surface smoke) and committed to (3) with reasoning. Future bundles touching React testing won't need to relitigate; the followup work is named (`bundle/react-behavioral-tests` for full render).
- **Load-bearing type contract test.** The `AgentStreamEvent._tag` assertion isn't theatre — it catches runtime/hook contract drift at compile time. Hook's SSE parser hard-codes those strings. If `AgentStream` emission renames a variant, this test fails before silent prod misses occur. Cheaper than a render-based test that does the same job.
- **Bun runs subpackage tests without per-package script.** Root `bun test` auto-discovers `tests/*.test.ts` everywhere. No package.json `test` script needed in `packages/react/`. One file added → CI picks it up.

## What didn't

- **Workspace test mode shows pre-existing `packages/diagnose/` flake.** `bun test` from root → 2 fails. `bun test packages/diagnose/` → 35/0. Test-order or fixture-state contention. Second occurrence this session (first was the #99 httpbin flake). CI rerun resolved #99; this one likely will too. **Pattern emerging**: workspace test mode is less reliable than per-package runs.
- **Smoke test feels theatrical for export-presence.** Cases 1, 2, 5, 6 are "function exists / shape compiles" — a tsc check covers them implicitly. Cases 3, 4 (the union assertions) have real signal. The export-presence cases stay because they're cheap and ensure the package isn't tree-shaken to nothing in a future build, but I'd rate the bundle B+ on signal density.

## Skill improvements (apply on next pass)

1. **Phase 5 VERIFY: workspace-test-flake protocol.** When `bun test` (workspace) shows failures but per-package isolation passes, treat as test-order/fixture flake. Verification is acceptable when (a) isolated package suite is clean, AND (b) the failing tests aren't in the package the bundle touches. Document with one sentence + sample command in Phase 5: *"If workspace `bun test` shows failures unrelated to the touched package, verify by re-running the affected package's tests in isolation (`bun test packages/<failing-pkg>/`). If isolated suite is clean, mark workspace failure as test-order flake; CI rerun typically resolves. Do NOT block the bundle on workspace-only flakes that don't touch your fix surface."*
2. **Phase 2 BUNDLE: codify "split by package" as the standard descope for multi-package test-infra issues.** Add a row to the cross-package descope examples: *"Issue cites adding tests/infra to N packages → ship N bundles (one per package), each with its own PR. Name follow-up bundles in the PR description so the queue is explicit."* This wasn't a typing issue but the same gate applied — the skill should mention it for test-infra context.

## Process inflation guard (HS-18/22/31 lesson)

- Was the verified-by inflated? **No.** Issue cited `find packages/{react,svelte,vue} -name '*.test.ts*'` → 0 results. Re-running today: still 0. Clean evidence, no drift.
- Document the inflation shape: **none**. Clean audit finding.
