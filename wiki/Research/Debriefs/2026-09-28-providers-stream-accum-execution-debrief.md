---
type: debrief
status: completed
created: 2026-09-28
tags: [execute-backlog, bundle, providers-stream-accum, providers, streaming, function-calling, retro]
---

# Execution Retro: providers-stream-accum

Date: 2026-09-28
Budget: 90 min | Actual: ~55 min
Branch: `bundle/providers-stream-accum` → merged to local `dev`
Commit: `59233139` (code+test)

## Outcomes

- Issues closed: **#216**
- Issues descoped: none (singleton bundle)
- Net test delta: llm-provider **+2 tests** (459 → 461 pass; 0 fail both)
- Net LOC delta: +495 / −179 — dominated by the new 273-line openai parity test; the source refactor itself is **−137 net** across the two providers (94+126 changed lines collapsed into a 181-line shared helper)
- New files: `src/stream-tool-call-accumulator.ts`, `tests/openai-stream-tool-calls.test.ts`

## What worked

- **SCAN drift check re-scoped the fix cleanly.** #216's verified-by claimed litellm had 8 `toolCallAccum` occurrences and that `synthesizeAndEmitToolCalls` existed in both providers. Actual: litellm 5, openai 6, and the named symbol exists only in litellm (openai synthesizes inline). The duplication premise held, so the bundle proceeded after recording the drift and re-scoping on the issue. A naive implementation against the stale description would have hunted a non-existent openai symbol.
- **The existing litellm parity test was the perfect regression net.** Four pre-existing tests pin litellm's per-chunk and adapter-normalized emission ordering; the refactor had to keep them green unchanged. They did.
- **Grepping the duplicated symbol to 0 is a crisp acceptance check.** `grep -c toolCallAccum` → 0 in both provider files (helper owns it) is a single, verifiable "duplication eliminated" signal.
- **The warden disclosed its own deviation honestly** (real-`Response` fetch mock → established openai module-mock seam) instead of hiding it, with the concrete blocker (`mock.module` is process-global and leaks across files). That is exactly the `upward-report` behavior the contract wants.

## What didn't

- **The brief's test approach was wrong.** It asked the warden to drive openai.ts through a real `Response`/`globalThis.fetch` mock. That passed in isolation but failed in the full suite because `mock.module` leakage (`provider-adapter-wiring.test.ts:102`) shadows the real SDK. The warden correctly fell back to the established module-mock seam (as `openai-nonok-guard.test.ts` / `openai-cache-usage.test.ts` do). Cost: one warden round-trip. The lesson belongs in the briefing template, not the warden's judgment.
- **No openai stream test existed before this bundle.** The bundle's own net (the litellm test) only covered one of the two call sites. Adding the openai parity test was necessary to pin the extraction, and it inflated the diff — but the source change is a net deletion. Not a problem, just worth noting when reading "+495".

## Skill improvements (apply on next pass)

1. **Warden-brief test-seam rule (providers).** When a MissionBrief asks for a provider streaming test, specify the package's **established mock seam** (e.g. the openai SDK module mock used by `openai-nonok-guard.test.ts`), never "real SDK + `globalThis.fetch`" — `mock.module` is process-global and leaks across files in the same package, making real-SDK streaming non-deterministic in-suite. Add this to the MissionBrief key-task when the target package has a documented mock-module caveat.
2. **Extraction/dedup bundles must cover every call site.** When a bundle's "test net" for a shared-helper extraction covers only one of N call sites, add parity tests for the uncovered sites **in the same bundle** (test+refactor combo). Otherwise a behavior divergence at the uncovered site ships silently. Add to the Phase 3 PLAN "Substrate-aware test strategy" area.
3. **Acceptance check for "duplication eliminated":** grep the duplicated symbol to **0** in every former owner. Prefer this over "helper exists" (which can coexist with leftover duplicated code). (Reinforces the existing verified-by discipline with a concrete extra form.)

## Process inflation guard (HS-18/22/31 lesson)

No inflation. Both the issue's occurrence count (litellm 8 → 5) and its named-symbol claim (both providers → litellm only) were inaccurate, caught at SCAN and corrected on the issue before execution. The executed acceptance claim (`toolCallAccum` → 0/0) is exact and independently re-run by the parent.
