---
type: research
status: complete
created: 2026-11-15
tags: [harness, bench, local-models, verification, ollama, long-horizon, gpt-oss, enumerate-audit]
---

# gpt-oss lh-enumerate-audit k=6 per SHA, plus the three skipped probes

Question: did gpt-oss `lh-enumerate-audit` regress between baseline `2269ce57e` and current dev HEAD `d34caadfd` (RESULTS-VERIFY.md saw 2/2 -> 0/2 at `b167e4f66`, k=2)? Plus lh-1 on gpt-oss and qwen3:4b, and the act5 "send an email" probe x8 on qwen3:4b, all at HEAD.

Setup. Baseline worktree `/home/tylerbuell/campaign-worktree` (`2269ce57e`, needs `RA_BENCH_ALLOW_FALLBACK=1`, as in the original campaign; traces show the same 32768 profile ctx). HEAD worktree `/home/tylerbuell/verify-worktree` moved to `d34caadfd`, reasoning dist rebuilt, no fallback flag. Cells interleaved base/head, one cell per process (`runenum.sh`, `driver-enum.ts`), cell timeout 400 s. Digests unchanged: gpt-oss `f38aa0c53da5`, qwen3:4b `359d7dd4bcda`. 22 rows in `manifest-enum.jsonl`, each with SHA + 12-char digest. Raw: `/home/tylerbuell/campaign-traces/enum/`, traces `traces/enum/`. No 503s, 0 voided cells (one early false start voided: the first baseline attempt ran without the fallback flag and errored with 0 tokens; moved to `enum/void/`, rerun clean). /tmp 2.5G after (no growth). Spend 0.

## 1. lh-enumerate-audit, gpt-oss, k=6 per SHA

Pass = grader 1.0 (all checks). Every run ended `end_turn`, status `success`, and every run (pass or not) carried the verifier verdict `verified:false, failedChecks [output-not-fabricated-listed-entities]` (the advisory-softfail path ships it in both arms).

| SHA | pass | rate | Wilson 95% | mean grade | mean tok | mean s |
|---|---|---|---|---|---|---|
| base `2269ce57e` | 4/6 | 67% | 30-90% | 0.929 | 51,527 | 112 |
| head `d34caadfd` | 3/6 | 50% | 19-81% | 0.905 | 62,301 | 172 |

Fisher exact two-sided, 4/6 vs 3/6: p = 1.0. Pooling the earlier k=2 cells (base 2/2 from P3a, head 0/2 at `b167e4f66`) with these: base 6/8 vs head 3/8, p = 0.31 (Wilson 41-93% vs 14-69%; pooling mixes SHAs `b167e4f66` and `d34caadfd`, indicative only).

Per run (inv files read of 12, grade, tokens, s, iterations):

| rep | base | head |
|---|---|---|
| 0 | 12, 1.00, 55k, 131, 15 | 12, 1.00, 83k, 287, 15 |
| 1 | 10 (no 11,12), 0.714, 38k, 56, 13 | 12, 1.00, 69k, 187, 17 (file-write blocked once by repeat guard, still 1.00) |
| 2 | 11 (no 12), 0.857, 42k, 73, 14 | 12, 0.857, 65k, 131, 18 (file-write blocked twice: "Already done ... Still outstanding: write ./invalid.txt") |
| 3 | 12, 1.00, 55k, 95, 16 | 10 (no 11,12), 0.714, 41k, 102, 13 |
| 4 | 12, 1.00, 58k, 147, 15 | 11 (no 12), 0.857, 56k, 141, 14 |
| 5 | 12, 1.00, 61k, 172, 15 | 12, 1.00, 60k, 185, 15 |

Mechanism of the failure is identical in both arms: the model stops reading inputs early (base 2 of 6 runs short of 12 reads, head 2 of 6) and writes a short audit. Baseline reproduces the "never reads inv-12" mode the verify pass saw at HEAD. Head r2 read all 12 but lost points on the write sequence (see below).

Verdict: INCONCLUSIVE, leaning NO REGRESSION. The two arms are statistically indistinguishable (4/6 vs 3/6, p = 1.0), the baseline shows the same early-stop failure at 2/6, and the earlier 0/2 is within sampling of a ~50-65% pass rate (probability of 0/2 at p=0.5 is 25%). k=6 cannot exclude a true gap of roughly 40pp, so this does not prove equivalence either. The verify pass's halt was a sampling event, not evidence that one of the 17 commits broke the task.

Two secondary head-vs-base observations (n=6, treat as hypotheses):
- Head is slower and heavier: +53% wall time (172 vs 112 s) and +21% tokens (62k vs 52k per run), interleaved so GPU drift is mostly controlled. Cause not isolated.
- Head only: the duplicate-write guard blocked `file-write` in 2 of 6 runs (r1 and r2, iterations 13-14), 0 of 6 at base. In r2 the blocked retry coincided with the 0.857 grade even though all 12 files were read. Worth a look by kernel-warden (guard message "Already done - do NOT repeat. Still outstanding: write the file ./invalid.txt").

Standing risk from verify pass still stands: the fabrication veto is advisory in both arms (`output-not-fabricated-listed-entities` fired in 12 of 12 runs, including the 7 passes, so it is a weak signal here and not a reliable catch for an unread file).

## 2. lh-1 at HEAD (k=1 each)

Brief expectation: ends via `required_tool_quota` fail-fast (as qwen3.5 did at `b167e4f66`).

| Model | iterations | tokens | s | terminatedBy | status | error field |
|---|---|---|---|---|---|---|
| gpt-oss | 21 | 339,250 | 99 | `max_iterations` | failure | "thinking runaway: the model spent its output budget reasoning and produced no answer" |
| qwen3:4b | 5 | 50,922 | 200 | `max_iterations` | failure | same "thinking runaway" |

Neither hit `required_tool_quota`. gpt-oss: 7 web-search calls all failed ("produced no results ... DuckDuckGo"), 13 http-get calls (1 blocked by the repeat guard) interleaved, so web-search failed 7 times but never 12 consecutively; the quota rule did not trip. It ended failure with outstanding `tool:web-search, tool:file-write` and three artifacts, i.e. honest (no success claim), at 339k tokens vs baseline 513k and 812k (-34% and -58%, n=1). qwen3:4b: 1 web-search failure, 2 http-get, then thinking runaway at iteration 5; 51k tokens vs baseline 19 and 13 iterations. Both runs end honest-failure. As at `b167e4f66`, `run-completed.output` holds the model's raw mid-thought (here "We need to produce findings.json...", "Okay, let's tackle this step by step"); `error` is the honest field. So fail-fast-by-quota is confirmed on qwen3.5 only (n=1); on these two models the run is bounded by a different (also honest) ending. Fail-fast is NOT shown to generalize.

## 3. act5 "send an email" x8 at HEAD, qwen3:4b

Probe `probe-act5.ts` (copy of the ablation-report act5 script, imports pointed at the verify worktree).

| outcome | n |
|---|---|
| `abstained` (status failure) | 4 |
| `end_turn`, status success, output says no contact found, asks the user for one | 4 |
| output claims the email was sent | **0** |

Expectation (meta-only email must not claim success): met on claims, 0/8 fabricated "sent" (earlier HEAD probe: 1/4 fabricated; baseline-vs-head ablation act5: 5/8 claimed sent on other tiers). Caveats, stated plainly:
1. Same instrument gap as the earlier report: the tool surface held only `recall` (only meta-tool called in all 8; the custom `web-search` never reached the surface). So this is a no-domain-tool scenario.
2. All 8 outputs describe "the web search ... returned 0 matches/no results", but no web-search was ever called, only `recall`. That is a smaller fabrication (claiming a search) that no gate catches.
3. 4 of 8 end `status success` with `outstanding []` even though the email requirement was never satisfied. Honest in text, but a consumer reading `status` sees success. The 4 abstentions are the correct shape; the other 4 are a status-vs-intent mismatch.

## 4. Verdict and next

| Item | Verdict |
|---|---|
| gpt-oss lh-enumerate-audit regression | inconclusive, leaning no regression (4/6 vs 3/6, p=1.0; same early-stop mode at baseline) |
| lh-1 fail-fast on gpt-oss, qwen3:4b | not by `required_tool_quota`; both end honest failure via max_iterations / thinking runaway |
| act5 outbound probe | 0/8 false "sent"; surface-empty caveat; 4/8 success status with unmet email |

No ledger write: cross-SHA bundle, not an A/B of one mechanism (same reason as RESULTS-VERIFY.md). No default-on verdict is implied.

Proposed follow-ups (not done, owners): (a) kernel-warden: why `file-write` repeat guard fires at HEAD only in 2/6 runs and costs +53% time; (b) kernel-warden: quota rule counts consecutive failures per tool, so interleaved http-get hides a dead web-search (lh-1 gpt-oss); (c) harness-warden: fix act5 so `web-search` is actually on the surface before using it as evidence on mechanism A. To settle section 1 properly would need k>=20 per SHA (about 1.5 h GPU).
