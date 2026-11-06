---
type: harness-report
status: complete
created: 2026-11-06
tags: [h3, bonsai-2, tier, smoke]
---

# H3 smoke: bonsai-2:27b at dev 0b66000e3

Smoke test of `bonsai-2:27b` as a third, larger local H3 tier. It ran 3 tasks at k=1 and all 3 passed. The model runs about as fast as qwen3:4b, with no adapter problems found. A full k=5 run is safe to schedule.

Model: `bonsai-2:27b`. Ollama reports family qwen35, 26.9B parameters, **Q2_0** quantization, 8.3 GB, and a native context of 262144. Its capabilities are completion, vision, tools and thinking. It accepts thinking levels `false/low/medium/xhigh`, with `medium` as the default.

## Results (k=1, `--cell-timeout-sec 400 --budget-sec 560`, one chunk)

| Cell | Outcome | Wall | Tokens | LLM calls | Thinking chars per call | Stop |
|---|---|---|---|---|---|---|
| rw-9 | pass, acc 1.00 | 34 s | 4660 | 3 | 604 / 613 / 1073 | end_turn |
| h3-required-tools | pass, acc 1.00 | 28 s | 3860 | 3 | 47 / 659 / 562 | end_turn |
| h3-exact-value | pass, acc 1.00 | 11 s | 1760 | 2 | 125 / 39 | end_turn |

`rax-diagnose cause --all` gave `none/success` for 3/3 runs, all decisive. `attribute --all` found 0 failed runs. Every LLM call was a `stream` request with `maxTokens 7200`, which is the 1200 caller cap plus the 6000 thinking allowance. Single calls took 1.3 to 11.7 s. There were no errors and no `length` stops.

For comparison, the 6a6a full run took this long on the same tasks (median per cell): qwen3:4b took 23 / 42 / 10 s and cogito:8b took 15 / 12 / 7 s. bonsai is close to qwen3:4b speed and about 2x slower than cogito:8b.

## Adapter check

- **Thinking.** H3 leaves `thinking` unset, so `resolveThinking` omits the `think` param (`packages/llm-provider/src/providers/local.ts:441`). Ollama then applies its server default (`medium`), and thinking appears in the trace (`thinkingChars` > 0). Because the static entry sets `supportsThinkingMode: true`, `widenNumPredictForThinking` adds the 6000-token allowance (`local.ts:476`). A direct `/api/chat` probe showed that `think:true` is accepted (thinking 140 chars) and `think:false` suppresses thinking (0 chars, 0.4 s). Level strings (`"low"`, `"xhigh"`) are accepted too. The boolean adapter therefore has no defect on this model. It cannot select a level, but nothing in H3 needs one.
- **Tool calling.** Native FC worked. The model issued parallel `file-read` calls in one turn (h3-exact-value).
- **Stream cap.** No truncation occurred. The largest output was 601 tokens against the 7200 cap.
- **Static capability entry** (`packages/llm-provider/src/capability.ts:689-704`) has two cosmetic inaccuracies. The comment says "~27B Q4", but the pulled model is Q2_0 at 8.3 GB. `tokenizerFamily` is `"llama"`, but the model family is qwen35. Neither affected this run.
- **Observation, not a defect.** In h3-required-tools the model computed the mean in its thinking rather than calling `code-execute`. The answer was correct, and `code-execute` is not a required tool for this task.

## Runner gap: the tier is not registered

`run-h3.ts --tier bonsai-2:27b` fails with `H3: unknown tier bonsai-2:27b. Known: qwen3:4b, cogito:8b`, because the tier is missing from `H3_TIERS` (`packages/benchmarks/src/h3/run-h3.ts:65-73`). The smoke worked around this with a probe wrapper, `.agents/skills/harness-improvement-loop/scripts/run-h3-extra-tier.ts`, which lives in the scratch worktree. The wrapper adds the tier to the exported `H3_TIERS` object and then calls `runH3` with the same flags, so no package was edited. A permanent fix is a one-line `H3_TIERS` entry. `bun run repo scope` lists no owner for that file.

## Recommendation for the full k=5 run

- **Flags:** `--cell-timeout-sec 300 --budget-sec 560`. This doubles the standard 150 s cap. qwen3:4b, which runs at similar speed, reached the 150 s cap on rw-7, and its h3-plan-only and h3-todo-heavy cells ran 110 to 130 s. bonsai with thinking enabled needs headroom on those long tasks, or timeouts will look like failures.
- **ETA:** the qwen3:4b full run spent about 2530 s of cell time across 60 cells. bonsai should take about 45 to 60 min of cell time, plus about 7 s of per-cell trace/diagnose overhead. With a 300 s margin, each chunk stops starting cells after 240 s of elapsed time. Expect **about 10 to 14 chunks of up to 590 s, for roughly 60 to 90 min of wall time**.
- Comparability: other tiers use a 150 s cell cap. Report bonsai timeouts against its own cap, or rerun timed-out cells at 150 s for a like-for-like comparison.

Results: `results-bonsai-2-27b.json` (gitSha 0b66000e3). Traces are in scratch: `/home/tylerbuell/.claude/jobs/eaddf328/tmp/h3-bonsai/traces/`.
