---
tags: [harness, planning, root-cause, goal-completion, eval, north-star]
date: 2026-07-10
status: active
follows: 2026-07-10-harness-root-cause-closure-program.md
---

# Goal reliability + feedback loop program (2026-07-10, session 2)

Owner directives: (1) performance inconsistent, can't tell better/worse; (2) goal-based
execution doesn't run to verified completion; (3) tool calling tanked after meta-tool
changes — investigate and fix; (4) find the real diseases, reference leading harnesses;
(5) rebuild the eval loop for fast accurate iteration.

## Closed this session

### Tool-surface regression (`c4e964e8`) — postmortem

Repro (owner's scratch.ts, gpt-4o): research task saw only `[file-write, discover-tools]`
every iteration; 4 futile discover-tools calls; died on "Required tool quota not met…
file-write". **The LLM classifier had correctly returned `required: [web-search,
file-write]`** (llm-direct.jsonl evidence) — the harness overrode it, then punished the
model for the consequence.

Three stacked causes, all pre-dating the trigger:
1. `literalMentionRequired` inflection-blind: "web searches" ≠ `web-search` → correct
   requirement demoted as "hallucination".
2. Stage-1 builtins filter (tool-schemas.ts, 2026-05-06) stripped classifier-RELEVANT
   built-ins, contradicting its own header contract.
3. Discovery dead-end: `resolveToolSurface` pool = engine-pre-filtered set;
   discover-tools lists the FULL catalog and promises "callable next response" —
   structurally impossible for withheld built-ins.
Trigger (not cause): `find` going opt-in (`ea729966`) removed the web-egress crutch
that had masked 1–3 for research tasks.

Fixes: plural-tolerant matching; relevant built-ins visible (never enforced); discovered
names resolve schemas from catalog BEFORE deny-list (`permitted()`), so contract
forbidden/gate-narrowing still beat discovery. Verified: repro rerun = 5 task tools at
iter 0, 8/8 calls ok, `tool-grounded`, show.md produced. 19 new tests, mutants proven
red pre-fix.

**Meta-lesson (instrument):** the bench ALWAYS passes explicit `builtins` to
`.withTools({builtins})` — the bare consumer default path had ZERO eval coverage.
That is why this shipped invisible. T0 must include a bare-default-surface task.

### Shipped this session (commits)
- `c4e964e8` tool-surface regression (above).
- `247b5339` trace retention: catch-alls size-capped by non-ULID filename (structured-output.jsonl 3.5MB/day never aged out).
- `269996fb` bench instrument: T0 deterministic gate (`bench:t0`, offline ~1.2s), paired lift stats (per-task join, unpaired named, clustered-max SE, 1.96σ promotion band), pass^k (tau-bench, receipt hook). Verified: 324 benchmarks pass, tsc clean.
- `8f6ec822` contract→gate pins: W3 DISPROVED the audit's "runContract never reaches gate" / "multi-file protection never fires" claims (both live); pinned M1/M2. Real residue → task #44.
- `7b6e1ad1` ToT H5 + long-horizon: both ToT returns route through resolveCompletionStatus; ToT now threads horizonProfile into branch kernels (was dropped — A2 budget discipline never applied to ToT). Consumer-boundary pin, 2 mutants red.

### B5 status (H5 into all strategies)
DONE: reactive, direct (pre-existing), ToT (`7b6e1ad1`), adaptive (inherits from sub-result).
BLOCKED (→ task #40): plan-execute, reflexion, blueprint, code-action — `ReactKernelResult` (react-kernel.ts:258) drops `meta.harnessAuthoredOutput`/`budgetTerminalPartial`/`verificationWarning`, and these strategies derive completion from a different authority (quality gate / worker success / code-exec), so no kernel honesty marker reaches their return. Needs the sub-kernel signal-boundary primitive (project shippedUnverified into the result), NOT a mechanical edit. Adding a field with no honest reader would violate wire-and-pin.

### Empirical baseline for "inconsistent + never finishes"

rw-7 × cogito:8b × ra-full, n=5 identical runs: accuracy 67/67/67/33/0 (graded partial
credit), tokens 12k–28k, duration 22–78s. **Solved 0/5; honesty=claimed-success 5/5.**
pass^1 = 0. Both diseases in one cell.

## Issue map (verified with file:line by audit agents)

### P0-B Goal completion — W3 mission in flight
- B1 NO termination path checks goal semantics; verifier = grounding/structure only
  (verifier.ts:26 self-describes). The one semantic requirement ("answer",
  run-contract.ts:279) has no condition and its only judge (P6b checker,
  terminal-gate.ts:280) has zero callers.
- B2 `arbitrationContextFromState` (arbitrator.ts:1580-1614) never threads
  `runContract` → requirement-aware coverage silently degrades to tool-name diff;
  multi-file deliverable protection inert. → W3 wires.
- B3 P6b checkerVerdict never supplied — needs a checker implementation (deferred;
  design with per-entity requirements #39).
- B4 `showOutstanding=false` default (standing-frame.ts:79) — model never sees "what
  remains". Industry-converged fix is plan/outstanding recitation IN CONTEXT (Manus
  todo.md recitation; Claude Code TodoWrite; Deep Agents write_todos). DEFAULT FLIP
  NEEDS ablation or owner decision.
- B5 H5 done→partial degrade only in reactive+direct; plan-execute:522/1233,
  tree-of-thought:253, reflexion:570 report success from output presence. → W3 wires.
- Heuristic termination paths (content-stability Levenshtein >0.85, final-answer regex)
  exit with ZERO evidence — variance enters here structurally: same goal, different
  pacing → different termination path, none goal-checked.

### P1-C Measurement — W5/W6 missions in flight
Instrument audit verdicts (2026-07-10):
- No automatic tier at all — eval workflows manual-only. Owner's "can't tell" is
  structural.
- 25/45 tasks score keyword-presence, not correctness — caps detectable lift.
- Gate: unpaired pooled means; task-set asymmetry on one-arm errors; significanceK=1
  (68% band). pass^k exists only in comments; typical n=3, some verdict sessions n=1.
- Judge outage silently scores 0 on 7 tasks (indistinguishable from model failure).
- Replay machinery (packages/replay: exchangeKey hashing, replay LLM/tool layers,
  diffTraces) COMPLETE and unwired to any measurement — the house disease.
- Reporting has no capability axis.
Target: T0a scripted-test-provider bench in CI (seconds) → W5; T1 judge-free live smoke
(minutes); T2 paired stats + pass^k n≥8 (overnight, default-on decisions only) → W6.
3pp lift rule physically unreachable until keyword-regex tasks become graded checks.

### Research synthesis (2026-07-10 survey; converged = 3+ independent harnesses)
Directly actionable, mapped to our gaps:
1. Todo/plan recitation into context (Manus/Claude Code/Deep Agents; CONVERGED) → B4.
2. Machine-checkable acceptance criteria the agent cannot edit; termination = list
   exhausted, not model vibes (Anthropic long-running harness) → RunContract is our
   seat for this; B2/B3/#39.
3. Stop-gates re-checking ORIGINAL criteria; DeployBench: 97/154 failures were agent
   self-stops and self-checks verify the WRONG target → terminal gate must check the
   contract, not ask the model.
4. pass^k + paired differences + clustered SEs (tau-bench, arXiv:2411.00640) → W6.
5. Deterministic end-state graders over trajectory/judge grading (tau-bench, Anthropic
   evals guidance) → convert rw-1/2/3/6, cs-dishonest-bait to hidden checks.
6. Code-as-action: +20% absolute for open-source models (CodeAct, ICML 2024) — we HAVE
   code-action strategy; candidate default for local tier AFTER T2 can measure it.
7. Keep failures + own reasoning visible (Manus "leave the errors in"; Cognition full
   traces) → thought-continuity #38 + failed-result retention.
8. Mask don't remove tools mid-loop (Manus, KV-cache + confusion) — tension with lazy
   disclosure; revisit when measuring.
9. Best-of-n with verifier selection (Claude 4 SWE-bench 72.5→79.4) — later, needs
   cheap verifiers first.

## Sequence
1. W3/W5/W6 land + verify (this session). DONE — `8f6ec822`, `269996fb`, `7b6e1ad1`.
2. Bare-default-surface bench task (instrument gap from postmortem).
3. Bench P2 conversions (keyword→graded, judge→end-state) — unlocks 3pp rule.
4. B4 outstanding recitation: implement behind flag; A/B on rw-7/lh-1; owner decision.
5. #39 per-entity requirements + B3 checker design (one primitive: uneditable
   acceptance criteria, per-entity gating, stop-gate re-check).
6. #38 thought continuity ablation; #40 signal unification; #36 adaptive re-cut on the
   new instrument.

## Wave 3 (2026-07-11) — bench-truth team, 4 parallel wardens

Replay keystone landed prior session (`ef3cc3d6`: `.withReplayLLM` seam, sequential
table, makeReplayAgent, golden test — `.withLayers` can NOT override LLMService,
captured at construction). This wave makes the bench truthful enough to gate fixes,
then fixes proceed lift-gated.

| Mission | Task | Scope (disjoint files) | Delivers |
|---------|------|------------------------|----------|
| W-A graded-everywhere | #46 | tasks/* only | rw-1/2/3/6 + cs-dishonest-bait keyword→graded hidden-checks (rw-7/lh-1 pattern); discrimination proofs |
| W-B scoring integrity | #47 | judge.ts, report-format.ts, types.ts, sessions/, gate/ | inconclusive lane (judge outage/stub ≠ 0.0/0.95), schema scorer implement-or-delete, pass^k solve bar (declared metric change), runs≥8 reliability session |
| W-C replay CI lane | #45 | replay-agent.ts, golden/, trace run-completed emit | committed goldens, `bench:replay` keyless CI lane, trace output field fix, toolsUsed adapter, record-side assertions |
| W-D north-star spec | #48 | wiki write only | 2026-07-11-harness-north-star-architecture.md — 8 positions ([RATIFY]/[BUILD]) |

Warden verifies every upward report: rerun tests, review diffs, spot-check mutants.
After wave: re-baseline (declared metric change), THEN lift-gated fixes resume order:
#44 spine unification, #40 signal boundary (unblocks B5 remainder: plan-execute/
reflexion/blueprint/code-action), B4 recitation ablation, #36 adaptive re-cut, #38.
