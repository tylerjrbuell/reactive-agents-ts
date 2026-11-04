# Harness improvement loop: reference

Long-form detail for [SKILL.md](../SKILL.md). Read on demand.

## H3 frozen suite (`packages/benchmarks/src/h3/`)

| File | Use |
|---|---|
| `run-h3.ts` | `--out <ABS results.json> --trace-root <ABS dir> --tier qwen3:4b,cogito:8b [--k 5] [--task id,id] [--budget-sec 560] [--cell-timeout-sec 150] [--start-margin-sec N] [--meta-arm]`. One cell = one `runSession` with runs=1. Visits cells run-major, persists after each cell, resumes by cell id (`tier|task|run`) when re-invoked with the same `--out`. Never starts a cell it cannot finish inside `--budget-sec`. |
| `report.ts` | `<results.json>... [--md]` per (tier, task) solved, Wilson 95%, pass^5, billed tokens, LLM calls, cause labels; `H3TIER` pooled lines. |
| `regrade.ts` | `--results a.json,b.json [--dry-run]` zero-token re-grade: rebuilds each workspace from the trace and appends `eval-graded`. Idempotent; refuses on a score mismatch. Only needed for traces recorded before grader-in-trace (2026-11-03); new runs append the grade themselves. |
| `verdict.ts` | `--before <a.json,...> --after <b.json,...> --reason harness:<r> [--json] [--ledger <path> --weakness <t> --hypothesis <t>]`. Restricts `before` to the cells in `after`, recomputes attribution from every trace, prints one verdict line. Exit 0 only on fixed/improved. |
| `stats.ts` | `wilson`, `passHatK`, `intervalsDisjoint`. |
| `tasks.ts`, `freeze.ts`, `h3-manifest.json` | The 12 frozen tasks and suite hash. `tests/h3-suite.test.ts` guards the hash; a rerun must keep suite hash, arm (`ra-default`), tiers, k and cell timeout to compare against the baseline. |

Verdict decisions (`AttributionDecision` in `src/ledger.ts`):

| Decision | Rule |
|---|---|
| `regressed` | target count rose, or pooled pass rate dropped with disjoint Wilson intervals |
| `shifted` | target dropped, but another `harness:*` reason rose |
| `fixed` | target dropped to 0, nothing else rose |
| `improved` | target dropped, not to 0, nothing else rose |
| `no-change` | target did not drop (also flags a target absent from the baseline cells) |

Pitfalls:
- Run cells **foreground** with `timeout 590`; background bench cells get killed. Re-invoke until `remaining=0`.
- Tiers must be in `STATIC_CAPABILITIES` (`packages/llm-provider/src/capability.ts`). Others resolve `source="fallback"` (2048 ctx) and every cell is INCONCLUSIVE. `qwen3:4b` and `cogito:8b` are trusted; `llama3.2:3b`, `gemma4:e4b`, `gemma4:12b` are not (2026-11-03).
- `packages/reasoning` exports `dist`: rebuild it before a live rerun of a reasoning change. Other workspace packages run from `src` under Bun.
- Timeouts count as unsolved measured runs (`isMeasured` in `report.ts`); they carry `no-trace` in attribution.
- Traces live in gitignored `benchmark-traces/`. The committed results JSON points at them by absolute path, so attribution of an old run needs the local trace dir.

## `rax-diagnose` (zero tokens, reads the trace JSONL)

```bash
bun run --silent rax:diagnose attribute <runId|path|latest> [--json]   # harness vs model, reason, divergence turn, evidence, missing
bun run --silent rax:diagnose attribute --all [dir] [--real] [--json]  # tally by verdict / reason / confidence; --json lists every run
bun run --silent rax:diagnose cause <runId|path> [--json]              # how the run ended (23 labels incl. wrong-answer)
bun run --silent rax:diagnose cause --all [dir] [--real]
bun run --silent rax:diagnose grep <runId|path> "<js predicate on e>"  # e.g. "e.seq === 87", "e.kind === 'verifier-verdict' && !e.verified"
bun run --silent rax:diagnose replay <runId> --only=kernel-state-snapshot,verifier-verdict,harness-signal-injected
bun run --silent rax:diagnose diff <runIdA> <runIdB>                   # structural diff: stats, kinds, verdicts, final state
bun run --silent rax:diagnose signals <runId>                          # harness signals never rendered / ignored / contradicted
bun run --silent rax:diagnose debrief <runId>                          # decision timeline with rationale
```

`--real` drops synthetic (`test` provider) traces. A bare ULID resolves under `~/.reactive-agents/traces/` and `<cwd>/.reactive-agents/traces/`; `REACTIVE_AGENTS_TRACE_DIR` pins one dir. End users run the same commands as `rax diagnose ...` or `rax-diagnose ...` (`@reactive-agents/diagnose`).

Attribution reasons (`packages/trace/src/attribution.ts`): `harness:{false-veto, tool-surface, tool-call-dropped, tool-call-corrupted, premature-stop, evidence-truncated, evidence-missing, misleading-guidance}`, `model:{ignored-guidance, had-evidence-wrong-output}`, `unattributed`, `not-failed`. `missing` in single-run output names the trace signal that would make a `probable` verdict decisive: often the fix is to record that signal.

Trace event schema: `packages/trace/src/events.ts`. High-signal kinds: `llm-exchange` (request + response per turn; the attribution divergence `seq`), `tool-call-start/-end`, `eval-graded`, `run-completed` (status, authority, outcome), `verifier-verdict`, `harness-signal-injected`, `tool-surface-resolved`, `run-started.config` (mechanisms the run ran with).

## Zero-token verification of non-prompt changes

- Re-attribute recorded traces: `attribute --all <dir>` and `cause --all <dir>` (changes to attribution/cause rules or anything post-hoc re-score the existing corpus).
- Replay lane over the goldens: `bun run --cwd packages/benchmarks bench:replay` (CI runs it).
- Replay ablation of a flag over the recorded table: `bun run packages/benchmarks/src/replay-ablate.ts <FLAG> [value]` / `--baseline`; sweep with `replay-ablate-sweep.ts`. Measures control flow only: prompt-changing mechanisms are UNTESTABLE on a fixed table.
- North Star gate (deterministic scenarios, CI): `bun run gate:check`; baseline changes need `bun run gate:update` and a `BASELINE-UPDATE:` commit trailer.

## Lift gate (mechanism A/B, default-on decisions)

Source of truth: `DEFAULT_LIFT_POLICY` in `packages/benchmarks/src/gate/types.ts` (`minLiftPp: 3`, `maxTokenOverheadPct: 15` on billed tokens, `minTiers: 2`, `significanceK: 1`, `promotionSignificanceK: 1.96`, `minRuns: 3`) and `decide()` in `gate/gate.ts`. Verdicts: `reject` (a tier regresses), `underpowered` (a cell under 3 runs; not "no effect"), `default-on`, `opt-in`. The ablation-warden applies it.

```bash
timeout 590 bun run packages/benchmarks/src/run.ts --session <preset> --runs 3 [--task ids] [--variant a,b] [--models ids] --output <r.json> --timeout 180
rax eval gate --report <r.json> --baseline <a> --candidate <b> \
  --ledger wiki/Research/Harness-Reports/improvement-ledger.json --weakness "<t>" --hypothesis "<t>"
```

`--session` is a preset name (an unknown one prints the list). `--output` overwrites per invocation; use one file per cell set. Judge-graded tasks need a live judge on a non-SUT model: `JUDGE_LAYER=live JUDGE_PROVIDER=openai JUDGE_MODEL=gpt-4o-mini bun run packages/judge-server/src/index.ts` (without `JUDGE_LAYER=live` a stub scores 0.95). H3 tasks are judge-free.

## Remaining skill scripts (`scripts/`)

| Script | Status |
|---|---|
| `introspective-probe.ts` | Optional. Interviews the model outside the harness about its own run and cross-checks each claim against trace events (blind spots = harness communication failures). Supplements `attribute`, does not replace it. |
| `failure-corpus.ts` + `validate-entropy.ts` | Kept: `02-FAILURE-MODES.md` cites the corpus as the reproduction for tool-failure loops; the pair measures RI dispatch-signal AUC. Not part of the H3 loop. |
| `ollama-native-fc-context-probe.ts` + `ollama-native-fc-gate.ts` | Kept: wired to `bun run probe:ollama-fc[:replay|:gate]` (provider-warden domain). |

Retired 2026-11-03 (superseded by H3 + `cause` + `attribute` + `verdict.ts`; no code, CI or package-script callers; cited reports keep their results; scripts are in git history): `analyze-multi-model`, `bare-vs-harness-probe`, `cross-strategy-matrix`, `gemini-thinking-starve-probe`, `harness-evolve` (wrote the never-read `loop-state.json`), `harness-probe`, `harness-probe-analyze`, `harness-probe-confirm`, `harness-probe-wide`, `local-bench-narrow-2026-07-26`, `mcp-comprehension-probe`, `microbench`, `multi-model-test`, `ri-ablation`, `task-quality-gate`, `real-world-probes/*`.
