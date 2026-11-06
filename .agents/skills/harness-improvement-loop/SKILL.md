---
name: harness-improvement-loop
description: Harness improvement loop on the H3 frozen suite. SELECT the top harness-attributable failure reason from `rax-diagnose attribute --all`, LOCATE it in 2-3 decisive traces and pin it with a scripted test, FIX at the root via the owning warden, VERIFY fast-to-slow (zero-token, then targeted H3 cells, then full H3) with `h3/verdict.ts` giving one decisive verdict, RECORD results + a committed ledger entry. Use at the start of any harness improvement session.
user-invocable: true
---

# Harness Improvement Loop

One pass = one harness-attributable reason driven to 0. Every pass ends in a verdict: `fixed | improved | shifted | no-change | regressed`.

```
SELECT → LOCATE → FIX → VERIFY (0-token → targeted live → full H3) → RECORD
```

Tools (all verified 2026-11-03): H3 suite `packages/benchmarks/src/h3/`, `rax-diagnose cause|attribute`, `h3/verdict.ts`, lift gate `rax eval gate`. Command details, flags and pitfalls: [references/reference.md](references/reference.md).

Paths below: `D=wiki/Research/Harness-Reports/2026-11-03-h3-baseline` (baseline results JSON), `T=packages/benchmarks/benchmark-traces/h3` (its traces, gitignored, local only). Use the latest H3 run if newer.

## 1. SELECT: the top harness reason (zero tokens, ~1 s)

```bash
bun run --silent rax:diagnose attribute --all $T
```

Pick the `harness:*` reason with the highest count. Ties: prefer `decisive` confidence, then the cheaper cells. Do not probe first; the corpus already says where the harness loses runs. Model (`model:*`) and environment (`environment:*`: provider fault, abort, budget, failing tool) reasons are not this loop's target; `unattributed` means the trace lacks a signal (an instrument gap, fix the trace, not the harness).

List the runs that carry it:

```bash
bun run --silent rax:diagnose attribute --all $T --json \
  | jq -r '.runs[] | select(.reason=="harness:<r>") | "\(.confidence) \(.path)"'
```

## 2. LOCATE: read the cited turns, then pin it

Open 2-3 `decisive` runs:

```bash
bun run --silent rax:diagnose attribute <path>   # verdict, divergence iter/seq, evidence seqs, missing signals
bun run --silent rax:diagnose cause <path>       # how the run ended (+ failed grader check)
bun run --silent rax:diagnose grep <path> "e.seq >= <seq>-5 && e.seq <= <seq>+2"
```

Read the cited `seq`s. Write down in one line each: the failure, the mechanism (file:line), the structural fix, and the after-trace you expect. No falsifiable expectation means keep reading.

Reproduce as a scripted pin before any fix: a test on the `test` provider (`TestLLMService` / scripted responses) that drives the same shape and fails on today's code. Example: `packages/reasoning/src/kernel/loop/loop-detect-turn-boundary.test.ts`. The pin must go red when the fix is cut out.

## 3. FIX: at the root, via the owning warden

Route through the domain warden for the anchor (`AGENTS.md` warden table) with a MissionBrief (`.agents/skills/mission-brief/SKILL.md`). One structural change per pass. Fix the boundary, not the 3rd call site. Termination/outcome logic goes in the shared substrate (AGENTS.md pitfall 12). The main thread dispatches and verifies; it does not patch warden-owned paths. `packages/reasoning` exports `dist`, so rebuild it (`bunx turbo run build --filter=@reactive-agents/reasoning`) before any live rerun of a reasoning change.

## 4. VERIFY: fast to slow, stop at the first failure

**(a) Zero tokens.** Scoped tests + the pin. If the change does not alter prompts (control flow, termination, veto, attribution rules), also re-run `attribute --all $T` and `cause --all $T` on the existing traces and run the replay lane (`bun run --cwd packages/benchmarks bench:replay`). Prompt-changing changes cannot be judged on recorded traces; go to (b).

**(b) Targeted live.** Rerun only the cells that carried the reason, k=5, both tiers, into a NEW results file and trace root:

```bash
O=wiki/Research/Harness-Reports/$(date +%F)-h3-<slug>
timeout 590 bun run packages/benchmarks/src/h3/run-h3.ts --out $PWD/$O/after-<slug>.json \
  --trace-root $PWD/packages/benchmarks/benchmark-traces/h3-<slug> \
  --tier qwen3:4b,cogito:8b --k 5 --task <id,...> --budget-sec 585 --cell-timeout-sec 180 --start-margin-sec 100
```

Foreground only; re-invoke the same command until it prints `remaining=0` (resume by cell id). Then the verdict:

```bash
bun run packages/benchmarks/src/h3/verdict.ts --before $D/results-qwen3-4b.json,$D/results-cogito-8b.json \
  --after $O/after-<slug>.json --reason harness:<r> --mechanism <activity key of your fix>
```

Success = `FIXED` (target 0, no other `harness:*` reason rose) or `IMPROVED`. `SHIFTED` = target gone but a new harness reason appeared: not a success, it is the next pass's SELECT. `INERT` = your mechanism fired in 0 after-runs: whatever moved, the fix did not cause it (2026-11-04: a checklist "lift" of 0/5 to 3/5 came out INERT because the `todo` tool was never offered). Exit code 0 only on fixed/improved.

**Always pass `--mechanism`.** It is a fragment of an activity key the fix produces (`guard:<guard>:<outcome>`, `signal:<kind>@<origin>`, `strategy-switch:...`, `requirement:<kind>@<source>`). The verdict also prints every activity key whose run count changed, so you can see what else moved. A fix that changes behavior but emits no activity key is not measurable: make it emit a guard-fired event or ledger fact first. Per run: `rax-diagnose attribute <trace>` prints the `activity` line.

**(c) Full H3** only before promoting anything onto the default path: all 12 tasks, k=5, both tiers, same suite hash / arm / cell timeout as the baseline; then `rax eval gate` if it is an A/B of a mechanism (ablation-warden).

**Pass-rate claims:** only when pooled 95% Wilson intervals are disjoint (`verdict.ts` prints `RESOLVABLE`). At n=5 per cell a gap under ~26pp is noise. Count drops are the signal; rates are context.

## 5. RECORD: results + ledger, every verdict

1. Results JSON under `wiki/Research/Harness-Reports/<date>-h3-<slug>/` (committed; traces stay local).
2. Ledger entry, every verdict including failures (the file is committed):
   ```bash
   bun run packages/benchmarks/src/h3/verdict.ts ...same args... \
     --ledger wiki/Research/Harness-Reports/improvement-ledger.json \
     --weakness "<one line>" --hypothesis "<the structural fix>"
   ```
   A lift-gate verdict records with `rax eval gate ... --ledger <same path> --weakness ... --hypothesis ... --activations <n>`, where `n` is how many candidate runs the mechanism acted in (count its guard/redirect events in the traces first). `--activations 0` books the entry `void`: an A/A run false-rejects about 30% of the time at H3 sizes (2f, 2026-11-06). List with `rax eval ledger`.
3. Commit message: reason + counts before/after, the verdict line, pin test name, test counts. No `Co-Authored-By`.
4. Short report `.md` beside the results when the finding is non-trivial (see `2026-11-03-h3-baseline.md`).

## Users: same commands on your own traces

Tracing is on by default (`~/.reactive-agents/traces/<runId>.jsonl`); send it elsewhere with `.withObservability({ tracing: { dir: "./traces" } })`. Then `rax diagnose cause <runId|path>`, `rax diagnose attribute <runId|path>`, and `--all <dir>` work unchanged (or `rax-diagnose` from `@reactive-agents/diagnose`). A clean-ending wrong answer reads `wrong-answer` only if the trace has an `eval-graded` event (H3/bench append it; your grader can too, the event type is public in `@reactive-agents/trace`).

## Anti-patterns

- Probing before reading `attribute --all`. The corpus is free; live runs are not.
- A claim from a pass rate inside the noise band, or from one tier.
- Fixing without a red-on-cut pin. Re-prompting a warden to review its own work.
- Background bench cells (they get SIGKILLed). `--out` into the baseline file (it resumes, it does not compare).
- Skipping the ledger entry because the verdict was bad. Bad verdicts are the record.
