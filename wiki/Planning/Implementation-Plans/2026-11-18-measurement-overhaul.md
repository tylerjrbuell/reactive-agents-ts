---
type: plan
status: draft
created: 2026-11-18
tags: [measurement, gate, eval, harness, lift, feedback-loop]
---

# Measurement overhaul: truthful gate, sound scorers, fast loop

Source audits (read first): `wiki/Research/Audits-2026-11-18-measurement/` 01 lift gate, 02 graders and judges, 03 feedback loop.

**Thesis.** "Building blind" is an instrument problem in three layers: the verdict rule (01), the scorers feeding it (02), and the loop around it (03). Binary accuracy on H3 cannot be both cheap and decisive; efficiency, large-harm detection and graded scores are where power is.

## Phase 0: instrument truth (days; no new mechanism, fixes only)

Owner: harness-warden (`packages/benchmarks`, `packages/trace`), kernel-warden for 0.4.

| # | Fix | Source |
|---|---|---|
| 0.1 | One shared gate-options helper so `rax eval gate` and `run.ts` agree (`tokenFree`, long-horizon). Print `runsNeeded` (fix the ~T factor) and per-task Fisher p on receipts. | 01 D5/D7 |
| 0.2 | Results record provenance: dist hash, RA_* flags, cell timeout, model digest, start margin. Runner default timeout 150 to 180 (match skill/baselines). Timed-out cells' tokens kept in the token mean. | 03 D3/D6 |
| 0.3 | Preflight + contamination guard: `api/ps` foreign-model check, load check, refuse/flag. | 03 D4 |
| 0.4 | Honest decline stopped by `dispatcher_early_stop` resolves to abstain (shared terminal path). | 02 D1, 03 D5 |
| 0.5 | Attribution: `ruleFalseVeto` before `ruleFabricationVetoed`; `forcing-unused` only when the lever is available. Before/after `attribute --all` table. | 03 D5 |
| 0.6 | Fix leaky scorers (rw-3 "40%"), remove dead `answerCorrect` hidden check, decouple abstention from the accuracy score (rw-6). Rescore saved data before/after; comparability break noted in receipts. | 02 D2/D5/D6 |
| 0.7 | verdict.ts pass-rate uses the gate's paired-by-task estimator, not disjoint pooled Wilson (it printed NO-CHANGE for a lever the gate rejected). | 03 D1 |

## Phase 1: gate v2 (additive `v2` field; v1 `decision` unchanged)

Owner: ablation-warden spec, harness-warden build in `packages/benchmarks/src/gate`.

- Accuracy axis: stratified risk difference, Newcombe/Miettinen-Nurminen CI, non-inferiority margin (default 10pp).
- Efficiency axis: per-task geometric token and turn ratio, bootstrap CI.
- Per-task veto: Fisher + Holm.
- New verdict `need-more-cells` (own exit code, prints N needed).
- Group-sequential looks at n = 3, 5, 8, 12; stop for harm/inert/futility.
- Dry-run: replay all existing receipts, publish a v1-vs-v2 diff table before v2 gates anything.
- Policy (owner ratification required): non-inferior + clearly efficient may promote to default-on.

## Phase 2: graded scoring

Owner: eval-warden (schema, judge-server receipts, zero-layer fix `verification-service.ts`), harness-warden (verdict consumes it).

- Additive `GradedOutcome` 0-1 on results; deterministic partial credit first (rubric checks per task).
- Judge (Jev/nimble) only for the ambiguous middle: honest-decline detection, multi-criterion rubrics, ungroundable groundedness. Offline on saved traces, never during a bench. Pinned model+prompt version in receipts. Calibration: 60 hand-labelled cells, kappa >= 0.7 before it may influence a verdict.
- Note: Jev's variance win is POC-scoped; the 2026-09-23 gate found parity (n=16); no data on nimble.

## Phase 3: fast tiered loop

- Tier 0 (seconds, zero token): replay goldens, cf-* scenarios, failure-shape zoo (exact-value partial answer, honest decline stopped early, false veto, no-call stall), scorer fixtures.
- Tier 1 smoke: cogito:8b on exact-value, todo-heavy, required-tools, plan-only; k=5 paired interleaved; sequential stopping; ~5-10 min/arm; ~19pp pooled detectable.
- Tier 2 full gate: default-on candidates only; 11 tasks, k>=8, 3 tiers; ~29 min/arm on cogito; MDE ~9pp.
- Canary: always-pass tasks, k=3, ~4.5 min.
- Task pruning: ~66% of qwen3:4b wall is on 10/10 or 0/10 tasks; drop from smoke, keep in canary. Replace saturated/floor tasks with discriminative ones.
- Unattended detached driver (bench cells get SIGKILLed as bg tool tasks): owner decision.

## Order and acceptance

0.1-0.3 and 0.7 first (cheap, unblock trust) then 0.4-0.6 (rescore), then Phase 1 dry-run, then Phase 3 tier 0/1, then Phase 2. Each step: `bun run repo verify <pkg>`, before/after table on saved data, ledger entry. No default-on change is judged by v2 until its dry-run diff is published and the owner ratifies the policy.
