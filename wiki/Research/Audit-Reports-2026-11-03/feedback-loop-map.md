---
type: audit-report
status: in-progress
created: 2026-11-03
tags: [feedback-loop, eval, bench, replay, diagnose, attribution]
---
# Feedback-loop map and design: one fast, decisive signal

Scope: these are user-facing diagnostics first. Framework users run the same trace analyzers (`rax-diagnose cause`, `attribute`, replay) on their own agents' traces; the framework's own improvement loop is one consumer of the same public APIs, not a separate dev tool.

Question: when we change the harness, do we know quickly whether runs got better or worse, why, and whether the harness or the model is at fault? Today: partly. This page maps what exists (survey of ~30 systems, 2026-11-03) and proposes building on it, not beside it.

## 1. What exists

| Layer | Systems (main path) | Answers | Cost |
|---|---|---|---|
| Live scoring | Bench runner `packages/benchmarks/src/runner.ts` + 18 session presets; H3 frozen suite `src/h3/`; `*-ablation.ts`; harness-improvement-loop skill scripts; prototypes | Pass rate per task/variant/model | Live tokens; minutes to hours |
| Grading | Deterministic graders (`judge.ts` verifiable/regex/abstention); judge-server; `packages/judgment`; `packages/eval` | Is the answer right | 0 (deterministic) or judge tokens |
| Per-run "why" | `packages/trace/src/cause.ts` (23 labels incl. `wrong-answer` via `eval-graded`); `analyze.ts`; bench `diagnose.ts`; `rax-diagnose` | How the run ended; which grader check failed | 0 |
| Verdicts | Lift gate `src/gate/` (`default-on/opt-in/reject/underpowered`); ablation-warden; `trace/cohort.ts`; `EvalService.compare` | Is B better than A | 0 over reports |
| Zero-token regression | North Star gate (`packages/testing/src/gate/`, CI); T0 deterministic (CI); replay lane + 5 goldens (CI); `replay-ablate(-sweep)` | Did control flow / scores change on scripted shapes | 0 |
| Learning | RI learning engine + calibration (`reactive-intelligence`) | Per-model priors, bandit strategy choice | 0 |

## 2. Gaps that make us build blind

1. **No harness-vs-model attribution.** `cause.ts:16-18` explicitly declines `model-incapable`; nothing names the turn where a run went wrong or whether the needed evidence was in that turn's prompt.
2. **Zero-token replay cannot judge prompt-changing mechanisms.** The sequential table returns old responses to new prompts (`replay-ablate.ts:24-28`); such mechanisms are marked UNTESTABLE. Most harness levers (guidance, projection, tool surface) change prompts, so they always need full live runs.
3. **Corpus poverty.** The 5 goldens are recorded from the scripted test provider, not real models. Live traces are gitignored and pruned (`benchmark-traces/`, `recorder.ts`), so real-model evidence evaporates.
4. **Six regression checks, six baselines** (North Star gate, T0, replay lane, `ci.ts` drift, eval `checkRegression`, lift gate) and five "is B better" engines. The ablation-warden rule (`ablation-warden.md:32-41`: 3 tiers, 15-30% opt-in band) disagrees with the gate code (`gate/types.ts:123-129`: 2 tiers, minRuns 3).
5. **The learning loop optimizes the wrong signal.** RI bandit reward is `1 - meanEntropy` (`learning-engine.ts:127`), not task success.
6. **Dead or broken loop plumbing.** (Fixed 2026-11-03 in `48178dfe1`: trailer path, regression gate runs >= minRuns, loop-state paths deleted, ledger committed, warden rule aligned to the gate code. Unread RunObservation fields still open.)
   - CI `BASELINE-UPDATE` trailer check greps a wrong path and can never fire (`ci.yml:~112` vs `packages/testing/src/gate/runner.ts:39-42`).
   - Weekly `regression-gate.yml` can never reject: `runs: 1` < `minRuns: 3` gives `underpowered`, which exits 0; no judge is started.
   - `loop-state.json` (read by `scripts/gate-propose.ts`) does not exist; `improvement-ledger.json` is gitignored, last write 2026-07-26; `weakness-queue` is only imported by its test.
   - Recorded-but-unread: RunObservation `subagentInvoked/subagentSucceeded/argValidityRate`.

## 3. Design: Run, Grade, Attribute, Compare (one loop, three speeds)

Builds on the existing runner, H3, `eval-graded`, `cause.ts`, replay package and lift gate. No new parallel system.

**D1. Durable real-run corpus.** Every H3/bench cell keeps its trace plus `eval-graded` in a content-addressed store (committed index, traces stored compressed or in a git-lfs/artifact dir). This becomes the replay and attribution corpus. Retire the scripted-only goldens as the sole replay corpus.

**D2. Attribution pass (zero tokens).** A `trace` analyzer run per failed cell:
- locate the first turn that produced the failing artifact or answer (from tool-call-end args, file writes and `eval-graded` checks);
- check whether the evidence the grader needed was present in that turn's projected prompt (llm-exchange request), whether the tool result it relied on was correct, and whether guidance rendered at that turn contradicted it;
- label `harness:{evidence-missing|evidence-truncated|misleading-guidance|premature-stop|false-veto|tool-surface}` or `model:{had-evidence-wrong-output|ignored-guidance}` or `unattributed`.
Output joins `rax diagnose cause` (new `attribution` field). Every fix is then judged by "harness-attributable failures fell", not by noisy pass rate.

**D3. Prefix replay with a live suffix (cheap counterfactual).** Replay recorded turns verbatim up to the first turn whose request the change alters (detected by diffing the projected request), then go live from there. Cost is the suffix only. This makes prompt-changing mechanisms testable on the real corpus at a fraction of a full run, and gives the counterfactual "same state, stronger model" by swapping the model only for the diverging turn.

**D4. Three speeds, one verdict engine.**
- Fast (0 tokens, seconds): structural gates + replay on D1 corpus for non-prompt changes + D2 attribution deltas.
- Medium (suffix tokens, minutes): D3 on the failing cells that the change targets.
- Full (live, ~1 h per tier): H3 k=5 two tiers, only for default-path promotion.
All three report into the existing lift gate (`src/gate/`) as the single verdict; align `ablation-warden.md` with the code; every verdict auto-appends to the improvement ledger (committed, not gitignored).

**D5. Fix what is broken.** CI baseline-trailer path; regression-gate `runs >= minRuns` and judge or deterministic graders only; RI bandit reward from grade/outcome success when present; delete or wire `loop-state.json`, weakness-queue, unread RunObservation fields.

**D6. Did the change run? (mechanism activity).** Added 2026-11-04 after a false lift: a todo-list checklist read as 0/5 → 3/5 on H3 todo-heavy, but the `todo` tool was never offered, so the checklist never ran. `mechanismActivity(trace)` (`packages/trace/src/activity.ts`) reduces a run to stable keys for what the harness did: `guard:<guard>:<outcome>` (non-pass), `signal:<kind>@<origin>`, `strategy-switch:<from>-><to>`, `requirement:<kind>@<source>` (`declared-mid-run` for ledger-declared after compile). `h3/verdict.ts` always prints which keys changed between arms, and `--mechanism <key>` gives `INERT` when the change fired in 0 after-runs. `rax-diagnose attribute` prints the same keys for users. Rule: a fix that emits no activity key is not measurable; make it emit one first. Its first live use caught the template-expansion fix compiling nothing on the absolute-path task text the run actually receives.

## Status (2026-11-04)
- **D2 shipped**: `attributeFailure` + `rax-diagnose attribute`, reasons in `apps/docs/.../reference/cli.md`. Reason `harness:completeness-blind` added 2026-11-04 (grader-required files never written, unknown to contract and ledger, run ended on its own).
- **D6 shipped** (`76c8714d3`).
- **D5 plumbing**: fixed (`48178dfe1`); regression gate advisory.
- **Open**: D1 durable corpus, D3 prefix replay, D4 single verdict engine. Lesson for every zero-token audit: compile the task text as the run receives it (runner rewrites paths), not the raw prompt.

## 4. Order (highest leverage first)
1. D2 attribution pass on the existing 118 H3 traces (0 tokens; immediately says which H3 failures the harness can fix).
2. D1 durable corpus (H3 traces + grades; small).
3. D5 broken plumbing (small, removes false confidence).
4. D3 prefix replay with live suffix (largest speedup for prompt-changing levers).
5. D4 consolidation into one verdict engine and committed ledger.
