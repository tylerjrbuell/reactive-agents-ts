---
type: research
status: partial
created: 2026-11-14
tags: [harness, bench, local-models, verification, ollama, h3, long-horizon]
---

# Live verification at b167e4f66 vs the P2a/P3a baseline (2269ce57e)

Scope: do the 17 commits since `2269ce57e` work on real local models, and did anything regress. Worktree `/home/tylerbuell/verify-worktree` (detached `b167e4f66`, reasoning dist built, 9 deps via turbo). Driver `/home/tylerbuell/campaign-traces/driver-verify.ts` (copy of the pinned driver, import path swapped), `runv.sh`/`loopv.sh` re-run the identical command until `remaining:0`. Rows: `manifest-verify.jsonl` (129 rows, every row `gitSha b167e4f66` + 12-char digest). Digests unchanged since baseline: qwen3.5 `56671c2ab938`, gpt-oss `f38aa0c53da5`, qwen3:4b `359d7dd4bcda`. Raw files: `/home/tylerbuell/campaign-traces/verify/*.json`, traces `traces/verify/`. /tmp 2.4G before and after (growth 0).

Status: PARTIAL, stopped by the brief's regression rule. Done: H3 k=3 on all 3 models, LH k=2 (5 tasks without lh-1) on qwen3.5 and gpt-oss, lh-1 once on qwen3.5. NOT run: lh-1 on gpt-oss and qwen3:4b, the act5 "send an email" probe (8 runs, qwen3:4b). Reason: gpt-oss `lh-enumerate-audit` went 2/2 to 0/2 (see section 4); I halted the chain. The unrun cells are about 1 minute each and cheap; resuming them needs only the owner's go-ahead.

Deviation from the brief: `RA_BENCH_ALLOW_FALLBACK=1` was NOT set (static capability rows b97b6c165/c81e48d39 are ancestors of HEAD). Traces still show `numCtx 32768, numCtxSource "profile"` for gpt-oss, same as baseline, so context is not a confound.

## 1. Before / after (n stated; k=3 H3 = 3 runs x 12 tasks = 36 cells; k=2 LH = 10 cells)

Noise rule: Bernoulli cells, 36 cells has about 8pp SE per model, per-task k=3 about 26pp. "inconc" = cells voided (cell timeout / abort), excluded from the rate.

| Model | Suite | solved base | solved new | rate (conclusive) base -> new | inconc | tokens/run base -> new | s/run base -> new |
|---|---|---|---|---|---|---|---|
| qwen3.5 | H3 | 29/36 | 27/36 | 87.9% -> 79.4% (-8.5pp, noise) | 3 -> 2 | 11,233 -> 11,014 (-2%) | 46 -> 46 |
| gpt-oss | H3 | 25/36 | 26/36 | 69.4% -> 74.3% (+4.9pp, noise) | 0 -> 1 | 11,961 -> 12,081 (+1%) | 35 -> 34 |
| qwen3:4b | H3 | 23/36 | 24/36 | 71.9% -> 72.7% (+0.8pp, noise) | 4 -> 3 | 9,638 -> 9,812 (+2%) | 61 -> 62 |
| qwen3.5 | LH (no lh-1) | 5/10 | 9/10 | 50% -> 90% (+40pp) | 0 | 40,482 -> 49,383 (+22%) | 124 -> 112 |
| gpt-oss | LH (no lh-1) | 10/10 | 8/10 | 100% -> 80% (-20pp) | 0 | 47,330 -> 39,616 (-16%) | 76 -> 81 |

Cell files carry total tokens only (no input/output split); billed = total for these local runs. endStatus success/failure: qwen3.5 H3 24/9 -> 27/7, gpt-oss 28/8 -> 26/9, qwen3:4b 24/8 -> 27/6; LH qwen3.5 8/2 -> 10/0, gpt-oss 9/1 -> 9/1.

Per task (solved, per run, `i` = inconclusive). H3 tasks at ceiling (3/3 before and after on all three models): ab-trap-4, ab-trap-5, h3-continuation, h3-exact-value, rw-9. Others:

| Task | qwen3.5 base -> new | gpt-oss base -> new | qwen3:4b base -> new |
|---|---|---|---|
| h3-plan-only | 111 -> 111 | 000 -> 000 | 10i -> 111 |
| h3-required-tools | 111 -> 111 | 111 -> 111 | 111 -> 111 |
| h3-todo-heavy | 111 -> 111 | 111 -> 111 | 11i -> 001 |
| rw-2 | i00 -> 00i | 000 -> 000 | 000 -> 000 |
| rw-3 | 11i -> 010 | 000 -> 00i | 000 -> 000 |
| rw-6 | 001 -> 0i0 | 110 -> 111 | i11 -> i11 |
| rw-7 | 1i1 -> 101 | 110 -> 011 | i00 -> i0i |
| LH rw-4 | 10 -> 11 | 11 -> 11 | - |
| LH rw-7 | 11 -> 11 | 11 -> 11 | - |
| LH lh-debug-green | 00 -> 10 | 11 -> 11 | - |
| LH lh-enumerate-audit | 11 -> 11 | 11 -> **00** | - |
| LH lh-pipeline-stages | 00 -> 11 | 11 -> 11 | - |

Attribution (`attribute --all`), failed runs: qwen3.5 H3 harness 1 of 8 (13%, evidence-truncated) -> 1 of 9 (11%, same reason); gpt-oss H3 harness 3 of 12 (25%: plan-fanout-blob, evidence-missing, tool-call-dropped) -> 2 of 11 (18%: evidence-truncated x2); qwen3:4b H3 harness 0 -> 0. LH harness:false-veto across qwen3.5+gpt-oss: 3 (qwen3.5 x2, gpt-oss x1, plus 1 qwen3.5 misleading-guidance) -> 1 (gpt-oss, rw-7). The brief's "LH false-veto 5" includes qwen3:4b LH, which this pass did not re-run.

Gate: no tier moved by a promotable amount on H3 (every |delta| under the 1-sigma band at n=36), so under `evaluateLiftGate` semantics this is `opt-in`-equivalent: neither lift nor regression on H3. LH is mixed (+40pp qwen3.5, -20pp gpt-oss). I did NOT write an improvement-ledger entry: this is a cross-SHA before/after of 17 bundled commits, not an A/B report of one mechanism, so `rax eval gate --ledger` has no valid baseline/candidate pair. Do not read this as a default-on verdict for anything.

## 2. Per-fix verdicts

| Fix | Verdict | Evidence |
|---|---|---|
| SideEffectLanded, clause-scoped (d1eb475e9) | NO SIGNAL (no regression) | h3-continuation and h3-exact-value 3/3 on all 3 models before and after; ceiling, cannot show lift. Tokens flat (qwen3.5 1,885 -> 1,906 and 1,941 -> 1,928). |
| Broken-tool fail-fast (0318f3dde) | WORKS (n=1, one model) | qwen3.5 lh-1: 8 iterations, 46,497 tokens, 46 s, `terminatedBy required_tool_quota`, status failure, `run-completed.error` = "Required tool unavailable: web-search (failed 12 consecutive attempts)...", outstanding list names file-write and the three artifacts. Baseline qwen3.5 lh-1: 33 it / 553k tok and 12 it / 81k tok, `stall_deliverable`. Corrected baseline from the manifest: gpt-oss was 47 and 46 it (513k, 812k tok), qwen3:4b 19 and 13 it; the brief's "46-47 it / 1.8M" matches gpt-oss only. gpt-oss and qwen3:4b NOT re-run. Caveat: `run-completed.output` still holds the model's last mid-thought ("Let me try a different approach..."), so a consumer reading `output` sees a continuation announcement; `error` is the honest field. |
| Ignored-abstain fix (2bbeb2d33) | NO SIGNAL | No "enumeration" stall ending appeared in any verify run. `stall_deliverable` endings: qwen3.5 LH 4 -> 0 (rw-7 x2 gone, lh-1 now fail-fast), gpt-oss LH rw-7 1 vs baseline 0. The 2 baseline gpt-oss `model:ignored-guidance` failures are gone (0 now). Suggestive, not a clean test of the fix. |
| False-veto runtime fix (e7c812dce) | WORKS (small n) | qwen3.5 LH `harness:false-veto` 2 -> 0 and `misleading-guidance` 1 -> 0 (lh-1 aside). qwen3.5 rw-7: H3 1i1 -> 101 (noise), LH 11 -> 11. gpt-oss rw-4 (baseline false-veto case): LH 11 -> 11, tokens 64.6k -> 28.5k/run, no max_iterations ending (baseline had one). 1 false-veto remains (gpt-oss LH rw-7, `stall_deliverable`). |
| code-execute hoisting + ENOENT hint (7bacddc84) | NO SIGNAL on success; explanations WORK | h3-required-tools: mean correct 3/3 on all models before and after, but no model called code-execute this time (baseline gpt-oss 3 calls, qwen3:4b 1). qwen3.5 code-execute 0 successes in 13 calls (H3 8, LH 5), baseline 0 of 16; gpt-oss 2 of 7 calls ok (baseline 6 of 17). Failures are now never empty and name the cause: "is a shell command, not JavaScript/TypeScript" x3, "Cannot find module './src/validator'" x3, "Export named 'run' not found in module 'bun:test'" x1. NEW failure class: "Unexpected output format (missing sentinel). stderr: (none)" x2 (packages/tools/src/skills/code-execution.ts:89). Models still misuse the tool; the fix made the errors legible, not the calls correct. |
| Declared/evidence/heuristic basis + receipt-backed claims (65aba0d1a, b167e4f66) and declared outbound requirement (9dd3fb011) | NO NEW FALSE-SUCCESS CLASS; one watch item | See section 3. Outbound-requirement fix is untested here: the act5 "send an email" probe was not run. |

## 3. Risk side: runs that ended `success` but the grader scored below 1

Count of success-but-graded-0 cells (`eval-graded` not passed while `run-completed.status=success`), baseline -> new: H3 qwen3.5 2 -> 6, gpt-oss 10 -> 7, qwen3:4b 9 -> 9 (totals 21 -> 22, flat); LH qwen3.5 5 -> 1, gpt-oss 0 -> 2. Cells that are newly success-and-wrong where baseline was right, traced:

1. qwen3:4b h3-todo-heavy runs 0 and 1 (baseline 2/2 conclusive pass): model issued all 12 read/write calls in one batch at iteration 0, wrote wrong values (246, 48, 600... instead of 34, 84, 16...), then claimed "out-1.txt: 34 (double of 17)" while the file held 246. Grade 0. `exit_gate accept`, `outstanding []`, verifier "12 checks passed". Cause: model arithmetic plus a final claim that contradicts its own write receipts. Receipt-backed claims check that a successful write receipt EXISTS, not that the claimed value matches the written content. Not caused by the new commits (same terminal path as baseline passes), but this is the class the receipt rule does not close.
2. qwen3.5 rw-3 (2 of 3 success, grades 0.67 and 0.83; baseline 2 of 2 conclusive pass): reports missing the "data table" and a grounded salary claim, `final_answer` / "delivery verified (3/3 conditions met)". Content quality; identical terminal path to baseline.
3. qwen3.5 rw-2 / rw-6 / rw-7 one extra each: partial-credit reports, same endings as baseline, within k=3 noise.
4. gpt-oss LH lh-enumerate-audit, both runs: see section 4. This is the one with a demoted veto.

Heuristic-demotion check: `deliverable_decision pass reason advisory-softfail` (runner-terminal-verify-gate.ts:480) appears in baseline runs too, so the demotion path is not new. In the gpt-oss enumerate runs it let a verifier-flagged answer ship: `run-completed.outcome.verifierVerdict.failedChecks = output-not-fabricated-listed-entities`, accepted anyway, status success, grade 0.857.

## 4. STOP trigger: gpt-oss lh-enumerate-audit 2/2 -> 0/2

Both runs: iteration 14, status success, grader 0.857, failed checks "audit.json is an array of 12 rows" and "INV-1117 marked valid=true". The model read inv-01..inv-11 and never inv-12 (baseline read all 12), wrote an 11-row audit.json, and listed INV-1117 in its summary without having read it. System prompt and tool surface are byte-identical to baseline except dates and paths (diffed), contract identical (5 requirements, no per-input coverage), no guard fired differently (same wire-request/tool_call_extracted/exit_gate/deliverable_decision/terminal_decision set). So no mechanism acted differently; the model stopped one file early twice. `rax-diagnose cause`: wrong-answer, attribution model:fabrication-vetoed (the verifier DID catch it). k=2 so the 100pp task delta is 2 cells; I treat it as an unexplained model-side drop that the harness could not stop, not as proof one of the 17 commits caused it. It is a task-class drop beyond noise on its face, hence the halt.

## 5. Prioritized new root causes (hypotheses, not fixes)

1. Fabrication veto is advisory when it matters. verifier flagged `output-not-fabricated-listed-entities` and `deliverable_decision` accepted it as `advisory-softfail` (packages/reasoning/src/kernel/loop/runner-terminal-verify-gate.ts:480). If a heuristic failed check names an entity the run never read, a bounded re-prompt ("you did not read inv-12") would turn 2 silent failures into passes. Needs an ablation before default.
2. Enumerated inputs are not requirements. `contract-compiled` lists output artifacts only; `plan-declared.ts` header says "inputs/placeholders dropped" and `requirement-basis.ts:40` already classes a "listed input" as evidence-basis, so the slot exists but the deriver (`verify/derive-conditions.ts:523 deriveDeliverablePaths`) never emits it. Twelve listed files, no coverage requirement.
3. Claim vs receipt content mismatch (todo-heavy). Receipt-backed claims verify existence, not value. A deterministic check "every `name: value` the answer asserts for a path the run wrote equals what was written" is computable from the ledger (golden rule 5).
4. Tool gate throttles the fallback route. During lh-1 the gate blocked `http-get` 16 times ("required tool(s) file-write are still missing; only one other call runs per turn", capabilities/decide/tool-gating.ts:467) while web-search was the broken tool and http-get the only working route, flagged `harness:misleading-guidance`. Fail-fast ended the run, but the gate wasted the iterations before it.
5. `run-completed.output` on a fail-fast exit carries the model's stray continuation text. `error` is correct; consumers reading `output` get "Let me try a different approach". Relates to the continuation-intent rule restored in b167e4f66.
6. code-execute still fails by model misuse (shell commands, relative imports, bun:test) and gained a "missing sentinel" mode (tools/src/skills/code-execution.ts:89). Low yield until the tool description steers away from shell commands.

## 6. Not done, and what would change a verdict

- lh-1 on gpt-oss and qwen3:4b (n=1 for fail-fast is thin). Outbound-requirement fix (9dd3fb011) has no live evidence: needs the 8-run act5 probe on qwen3:4b.
- Section 4 would need a k>=6 rerun of gpt-oss lh-enumerate-audit on both SHAs to separate sampling from a real shift; the pinned baseline worktree `/home/tylerbuell/campaign-worktree` still exists for that.
- qwen3:4b LH was not part of the brief; baseline LH false-veto total of 5 cannot be fully compared.
