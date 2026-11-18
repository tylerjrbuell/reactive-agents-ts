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

## Revision after advisor review (Fable, 2026-11-18) — supersedes conflicting text above

**Plan changes**
1. **Condition on the trigger.** Effect = P(trigger) x effect-given-trigger; whole-suite runs dilute it. Add (a) a zero-token trigger census over saved traces before any live cell, (b) prefix-fork probes: replay a recorded run to the trigger state (`packages/replay`), sample only the next model turn live, on vs off, k=30, binary proximal outcome.
2. **Pre-registered proximal metric per mechanism** (target failure shape, activity key, proximal metric, harm guard). Read order: fired, proximal moved, efficiency, accuracy non-inferior. Wire `verdict.ts` activity keys and reason-drop into the gate.
3. **Seed pairing moves into Phase 0** (McNemar on discordant pairs = our variance reduction). Unverified: Ollama seed honoured via `providers/local.ts`, GPU determinism, temp 0 not the user distribution.
4. **Per-task Fisher+Holm veto is nearly dead at planned n** (k=3 can never reach p<.05 two-sided; k=5 only a full 0/5 vs 5/5 collapse survives Holm over 11 tasks). Replace: magnitude trigger (task delta <= -40pp), automatic k=5 solo rerun, veto if it replicates.
5. **Non-inferiority: not 10pp as a licence.** Compare to a frozen reference baseline (no drift across promotions); require point estimate >= -3pp AND lower bound > -10pp; compute on discriminative tasks only (saturated tasks must not pad the pool).
6. **Cut group-sequential alpha spending.** Harm and inert checks every round at a strict fixed threshold; promotion only at a pre-declared final n (screen k=5, confirm k=12).
7. **Efficiency axis:** per-task log ratios with t-interval or sign-flip permutation test (bootstrap at n=3 under-covers); primary figure = tokens per solved task (guards fail-fast survivorship).
8. **Gate v2 acceptance:** simulated A/A false-reject <= 5% and stated power on planted -20pp harm and -15% tokens, using the audit's `sim.ts`, before v2 gates anything; plus the receipts dry-run diff.
9. **Order: zero-token tier before gate v2** (it would have caught the lft defect that cost a 46 min A/B). **Defer the Phase 2 judge** (labelling + kappa) indefinitely; H3 is deterministic. Keep only "verdict reads graded accuracy" (0.7) and add `scorerVersion` to receipts (0.6). No Bayesian loss rules yet.

**Phase Z (new, first): deterministic mock-provider tier** — `packages/benchmarks/src/sim/` (harness-warden; provider fixes by provider-warden/testing owner)
- `policy-model.ts`: `PolicyModel = (req, rng, purpose) => TestTurn`; `policyLLMLayer(model, seed)` routes by purpose (harness calls never consume agent script) and records requests.
- `shapes/*.ts`: `{ id, sourceTraceId, task, tools, policy, ideal:{terminatedBy,status,toolSeq,maxTurns} }`; `run-shape.ts` -> `runArm(shape, harness)`; `matrix.ts` shapes x mechanisms x {off,on} -> `helps|hurts|neutral|inert` + turn/token deltas; `tiers/*.json` seeded failure+compliance rates with provenance; `calibrate.ts`; CLI `bench:sim --mechanism X [--tier cogito-8b --seeds 500]`.
- First 5 shapes (from real traces): (1) partial answer with unread input (exact-value, lft defect); (2) honest decline stopped by `dispatcher_early_stop` (ab-trap-5); (3) no-call stall x4 (rw-7, actOrAnswer); (4) correct answer vetoed as fabrication (rw-6); (5) sequential independent calls hitting the iteration cap (todo-heavy, wrapUpReserve). Then repeat loop, hallucinated tool, premature final.
- Deterministic-decidable: loop detection, exit gate, termination labels, abstention resolution, budget/wrap-up/iteration caps, tool batching/healing, verifier false veto, request shape/size for prompt mechanisms, activity-emission. Needs live: whether the model complies with a prompt change (`parallelToolHint`, guidance, forcing nudges); forcing firing is deterministic, compliance is live.
- Known gaps to fix first: `fakeUsage` (`llm-provider/src/testing.ts:77-84,316`) ignores history and tool schemas (count tokens from the recorded `CompletionRequest`); static turns only (no reactive model); `ScenarioConfig` has no harness-config field and `runCounterfactual` writes to /tmp (tmpfs OOM); classifier peek protects only `toolCall` turns, so a `text`-first script can be eaten by a harness call.
- Stochastic tier model (`pStall`, `pPrematureFinal`, `pRepeat`, `pHallucinatedTool`, `pDecline`, compliance given a guidance marker): sweep compliance 0..1 to see whether a mechanism is harmful everywhere (veto) or only helps above x (the live question shrinks to one parameter, estimated with prefix-fork probes); power-plan live n = trigger rate x simulated effect. Fit rates from `rax-diagnose attribute` and compliance from existing receipts; must reproduce pth and lft directionally on held-out data before use; log predicted vs observed on every later live run.
- **Gate feed:** additive `GateVerdict.sim`, labelled `evidence: simulated (zero-token)`. Deterministic shape `hurts` with a cited source trace = hard veto (no live run until fixed). Stochastic harm = advisory, adds the task to the live set. `inert` on all shapes = blocks live spend until a shape triggers it. **Never promotes.**

## Order and acceptance (revised)

1. Phase Z core (provider gaps, `policy-model`, 5 shapes, `matrix`) plus Phase 0.1-0.3 and 0.7 (cheap instrument fixes) in parallel (disjoint owners).
2. Phase 0.4-0.6 (honest-decline label, attribution, scorers; rescore saved data, `scorerVersion`), trigger census + seed pairing.
3. Gate v2 (revised rules 4-8) with its simulated A/A + power acceptance, then receipts dry-run diff, then Tier 1 smoke and prefix-fork probes.
4. Simulator calibration against pth and lft, then stochastic tier.
Each step: `bun run repo verify <pkg>`, before/after table on saved data, ledger entry. No default-on change is judged by v2 until the dry-run diff is published and the owner ratifies the policy.
