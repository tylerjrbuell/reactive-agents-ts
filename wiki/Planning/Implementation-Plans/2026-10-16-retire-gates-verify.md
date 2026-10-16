# Bundle: reasoning-retire-strategy-gates-verify
Date: 2026-10-16
Budget: 45 min
Issues: #234 (singleton; verify-and-close, no production edit expected)

## Acceptance criteria
- #234: either (a) the per-strategy gates are proven redundant and removed/reduced with `blueprint-honest-partial`, `plan-execute-cumulative-budget`, `plan-execute-honest-partial` still green, or (b) the removal premise is proven false with current-code evidence and the issue is closed as premise-falsified with that evidence recorded. `bun test packages/reasoning` green either way.

## GROUND (parent, pre-dispatch — VERIFIED 2026-10-16)
- `plan-execute.ts:769-786`: wave gate consults shared meter via `resolveRunSpend(spentAtWaveStart)` + `isBudgetExhausted`, feeds `withSpentBudget(input.budgetLimits, spentAtWaveStart)` to wave kernels. Still present.
- `blueprint.ts:617-622`: `resolveRunSpend({tokens, cost})` → `overBudget = tokenLimit !== undefined && runSpend.tokens >= tokenLimit`; gates the SOLVE call. Still present.
- `strategies/budget/`: `remaining-budget.ts` + test, `run-budget-spend.ts` + test all exist — the #231 unification layer is live at both sites.
- Hot.md 2026-10-05 records the re-scope verdict: full removal is premise-falsified because direct LLM calls never enter the Arbitrator (blueprint runs NO sub-kernel per blueprint.ts:604-616 comment; plan-execute wave kernels get per-kernel reduced limits, so only the wave gate sees cumulative spend). Unification shipped instead (`5a169029`).
- Named tests exist: `blueprint-honest-partial.integration.test.ts`, `plan-execute-cumulative-budget.integration.test.ts`, `plan-execute-honest-partial.integration.test.ts`.

## Execution units (ordered)
1. **Unit 1 (parent, direct — no domain edits):** run the three named test files + `remaining-budget`/`run-budget-spend` unit tests. If green → close #234 with a premise-falsified evidence comment (code comments already cite #234 at both sites; no edit needed). If red → stop, do NOT hand-edit kernel code on the main thread; dispatch kernel-warden with a MissionBrief instead.

## Risk register
- Named tests green but gate actually redundant → mitigation: the blueprint no-sub-kernel comment + per-kernel-reduced-limits accounting are structural facts, not test outcomes; record both in the close comment.
- Full reasoning suite red unrelated to gates → mitigation: compare vs baseline; file follow-up, don't block closure.
- Closing without code change feels like non-shipment → mitigation: a falsified-premise closure with fresh evidence IS the deliverable (per execute-backlog stale-premise rule); it retires p2 architecture-debt and blocks a wrongful deletion.

## Verification protocol
- `bun test packages/reasoning/src/strategies/plan-execute-honest-partial.integration.test.ts packages/reasoning/src/strategies/plan-execute-cumulative-budget.integration.test.ts packages/reasoning/src/strategies/blueprint-honest-partial.integration.test.ts --timeout 15000`
- `bun test packages/reasoning --timeout 15000` — zero new failures vs baseline.
- Close comment cites file:line evidence + test counts.

## Out-of-scope (explicit)
- Any deletion/reduction of the gates (premise-falsified; explicitly NOT doing).
- `remaining-budget.ts` display-helper trim (only if still used — check imports; leave alone if used).
- #214 (cast ceiling premise drifted: raw grep now 99 src / 290 tests vs issue's 80/265 — needs re-grounding, separate bundle).
- #206 (needs design pass), #235 (next candidate, score 6), #240 (latent, score 3).

## Baseline
- dev HEAD `7ada99ce8` (#241 merge). Branch `bundle/reasoning-retire-gates-verify` off `dev` (repo staging convention; skill default is origin/main — deviation recorded).
- Baseline: `bun test packages/reasoning --timeout 15000` → 3162 pass / 0 fail across 365 files (== post-#241, no drift).

## Close-out (parent-direct verification, 2026-10-16 — no warden, no production edits)
- Named tests: 24/24 green (3 honest-partial/cumulative files + budget unit tests). Full reasoning suite 3162/0.
- Verdict: removal premise FALSIFIED (see GROUND + close comment). Gates are shared-meter-unified direct-call enforcement; `withSpentBudget` is the reduced-limits mechanism, not dead accounting. #234 closed with file:line evidence. No code changed — correct outcome per the stale-premise rule.
