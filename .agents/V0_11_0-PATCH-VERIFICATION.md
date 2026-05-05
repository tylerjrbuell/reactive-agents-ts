---
title: v0.11.0 Patch Release Verification Report
date: 2026-05-05
status: READY TO SHIP
---

# v0.11.0 Patch Release Verification

## Pass / Fail Summary

| # | Test | Result | Notes |
|---|------|--------|-------|
| 1 | `rax init --help` | ✅ PASS | Help text shown, exit 0 |
| 2 | `rax create agent --help` | ✅ PASS | Help text shown, exit 0 |
| 3 | `rax run --help` | ✅ PASS | Help text shown, no error prefix |
| 4 | `rax cortex` | ✅ PASS | "Unknown command: cortex" (intentional) |
| 5 | `rax --help` | ✅ PASS | No cortex listed in main help |
| 6 | CommonJS error message | ✅ PASS | `ERR_REQUIRE_ESM` code, clear message, working URL |
| 7 | SDK agent.run() | ✅ PASS | `await build()` → `await run()` works |
| 8 | LLM error helper present | ✅ PASS | 3 occurrences (declaration + 2 call sites) |
| 9 | Pattern ordering (5xx before auth) | ✅ PASS | Connection → 5xx → Auth → Rate → Timeout |
| 10 | CLI tarball clean (no cortex) | ✅ PASS | 0 cortex files in tarball |
| 11 | reactive-agents tarball has cjs-shim | ✅ PASS | `package/cjs-shim.cjs` present |
| 12 | No stale rax cortex docs | ✅ PASS | Only intentional reference in apps/cortex/AGENTS.md |
| 13 | CLI builds successfully | ✅ PASS | 176.44 KB ESM, types built |
| 14 | reactive-agents builds | ✅ PASS | All sub-package exports built |
| 15 | reasoning builds + tests | ✅ PASS | 1106/1106 tests pass |

## Issues Resolved

| ID | Severity | Description | Resolution |
|----|----------|-------------|------------|
| P1-1 | HIGH | `--help` flag broken in init/create-agent/run | Added help-check pattern (commit 72523f9b) |
| P1-2 | MEDIUM | CommonJS require fails with ERR_INTERNAL_ASSERTION | Added cjs-shim.cjs with clear ESM-only error (commit 8764606f, polish 8cf58ec0) |
| P1-3 | CRITICAL | `rax cortex` broken in npm-installed CLI | Removed from public CLI; added `bun cortex` for contributors (commit 4abc98dc) |
| P1-4 | MEDIUM | Vague LLM error messages | Added explainProviderError helper with 6 patterns (commit 2f8994eb, polish edecfab0) |
| P1-5 | (was CRITICAL) | SDK agent.run() missing | Verified false alarm — original test missing `await` on `.build()`. SDK works correctly. |

## Commits in v0.11.0 Patch

1. `72523f9b` fix(cli): respect --help flag in init/create-agent/run commands
2. `4abc98dc` feat(cli): remove rax cortex from public CLI
3. `389fe21b` docs(cortex): update AGENTS.md to reflect bun cortex workflow
4. `4ced3187` docs: update remaining rax cortex references to bun cortex
5. `8764606f` fix(reactive-agents): clear error for CommonJS require()
6. `8cf58ec0` fix(reactive-agents): use working docs URL and clearer CJS shim
7. `2f8994eb` fix(reasoning): actionable LLM provider error messages
8. `edecfab0` fix(reasoning): tighten LLM error pattern ordering and provider hints

## Pre-existing Issues (Not Blocking Release)

- `apps/cortex/ui#build` fails on full workspace build (svelte-kit cache issue, unrelated to our changes)
- 3 pre-existing TS2578 errors in apps/cli/src/commands/{demo.ts,run.ts} (`@ts-expect-error` directives that are no longer needed)

## Deferred to Future Releases

- **v0.12.0+:** Consider publishing `@reactive-agents/cortex` to npm so `rax cortex` could lazy-load it (similar to `rax bench` pattern)
- **v0.11.x:** Add provider-specific env hints for `litellm` config edge cases
- **v0.11.x:** Add unit tests for `explainProviderError` to lock pattern ordering

## Subagent Workflow Summary

Used `subagent-driven-development` skill — 5 implementer dispatches with two-stage review (spec compliance + code quality) for each task. All reviews passed (1 implementation iteration per task plus polish for Tasks #30 and #31 based on reviewer feedback).

## Ship Recommendation

**✅ READY TO SHIP v0.11.0**

All targeted patch issues are resolved and verified. The CLI is cleaner (no broken cortex command), the SDK has clearer error messages, and the public surface is more honest about what works in npm-installed mode.

Run `npx changeset` to bump to v0.11.0 and trigger the release workflow.
