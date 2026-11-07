---
type: research
status: complete
created: 2026-11-07
tags: [harness, spike, zero-token, projection, tool-result-budget, lh-1, attribution]
---

# Tool-result budget spike (zero-token), 2026-11-07

**Question.** How often does the fixed per-result budget (`toolResultMaxChars` = 1,200 on `local` and `mid`, `packages/reasoning/src/context/context-profile.ts:144,164`) cut evidence a run later needed? Would a larger fixed budget, or a fraction of the window, have kept that evidence? What would it cost in prompt size?

**Answer.** The budget did not cause a measured failure in this corpus. None of the 6 lh-1 runs that `rax-diagnose` attributes to `harness:evidence-truncated` lost evidence to the cut. In every one, the URLs the grader needed were visible on the turn that wrote the deliverable. The real causes are a model output defect (literal `\n` in Markdown file content) and a consistency error between `findings.json` and `sources.md`. No budget in the simulation removes a failure. 2.5k costs +1% to +7% prompt tokens per turn. **Recommendation: keep 1,200. Fix the attribution rule and the literal-newline defect first.** One structural change to the projection is worth an ablation (latest *batch*, not latest *result*, gets the recency budget). It is optional. Evidence of lift is absent.

## Corpus and method

- 240 trace files: `abl-auto/traces-*` (136, actOrAnswer ablation, 2026-11-07) and `verdict-h/corpus/{before,after}-{h3,lh}` (104, Workstream H verdict, 2026-11-06). No live runs. Scratch scripts and outputs: `/home/tylerbuell/.claude/jobs/eaddf328/tmp/tbs/` (`analyze2.py`, `simulate.py`, `lh1_table.py`, `regrade_unescape.py`).
- Models and windows (from `projection-rendered`): cogito:8b, gemma4:e4b, llama3.2:3b, qwen3:4b, qwen3:14b on `local` with a 32,768 window; gpt-4o-mini on `mid` with 128,000. There is 1 gemini-2.5-flash run (`mid`, 1,000,000). It has no tool results.
- **How the cut works** (`packages/reasoning/src/assembly/stages/project-results.ts:103-170`). The single *last* tool result gets `recencyBudgetChars` (window × 0.35 × 4: 45,875 chars at 32k, 179,200 at 128k). Every other result gets the 1,200 `toolResultPreserveBudget`. About 250 of those 1,200 chars are the preview footer, so the visible body is about 950 chars. The ResultStore keeps the full text. FM-17 escalation widens a truncated ref on the *next* turn (×2.5 → 3,000).
- **Instrument caveat.** In the ablation corpus, `tool-call-end.result` holds the act-time compressed preview for results over the budget, not the raw text. Raw text is only available from full views in recorded requests (capped at 2,000 chars per message, `RECORDER_MESSAGE_CAP`). Raw sizes come from the preview footer (`N chars total`) and `projection-rendered.compressions`. Request tool messages are tail-aligned to `tool-call-end` events. 1,113 of 1,132 requests aligned and the 19 misaligned were skipped.
- **Decisive turn.** A request whose response writes a file or ends the run. For lh-1, the "source turn" is the request whose response writes `sources.md`.
- **"Needed" test.** String containment of URLs, because the lh-1 grader checks URLs: at least 6 distinct URLs in sources.md, and no orphan citations. For each cut result: which URLs were hidden at the decisive turn, and whether they reach the deliverable.

## Findings

### F1. What gets cut: web-search results from parallel batches

Raw sizes of compressed results: web-search n=137, p50 2,101, p90 2,365, max 2,456 (5 results per search). http-get n=20, p50 2,836, max 164,800. file-read n=7, 2,988 to 4,624. The 1,200 budget shows about 2 of 5 search hits.

A result is "fresh-compressed" when it shows only as a preview on the first turn it is visible, so the model acts on it without ever seeing it whole. Counts are first views:

| model (tier, window) | web-search first views | fresh-compressed | http-get fresh | file-read fresh |
|---|---|---|---|---|
| gpt-4o-mini (mid, 128k) | 36 | 24 (67%) | n/a | 0/21 |
| llama3.2:3b (local, 32k) | 25 | 18 | n/a | 0/58 |
| qwen3:14b (local, 32k) | 27 | 16 | n/a | 0/44 |
| qwen3:4b (local, 32k) | 39 | 11 | 5/11 | 0/140 |
| cogito:8b (local, 32k) | 18 | 5 | 3/8 | 0/175 |
| gemma4:e4b (local, 32k) | 30 | 0 | n/a | 0/74 |

Fresh compression is entirely an artifact of parallel batches. Only the last result in a batch gets the recency budget, and its siblings are cut on arrival. gemma4 searches one call per turn and has 0 fresh cuts. gpt-4o-mini sends 4 to 6 searches at once and has 67%. 20 of 152 long-horizon-corpus runs had a fresh web-search cut, which matches the leverage scan's 20.

### F2. The cut does not predict failure

lh-1 runs with at least one preview on the source turn passed 10 of 19. Runs with none passed 5 of 18. Runs with a fresh web-search cut passed 7 of 20, and qwen3:14b passed 4 of 4 with one. Previews come with *more* searching, and more searching is the behavior that passes.

Every lh-1 run with fewer than 6 URLs visible on its source turn (13 runs) had **0 previews**. Those runs made 1 search, and too few searches caused the shortage, not compression.

### F3. All 6 `harness:evidence-truncated` lh-1 attributions fail the containment test

| run | URLs visible at source turn | previews | sources.md distinct / orphans (as written) | literal `\n` | after unescape | actual cause |
|---|---|---|---|---|---|---|
| gpt-4o-mini off r0 | 10 | 4 | 5 / 12 | yes | 5 / 7 | literal `\n`; sources.md lists 5 of the 8 URLs findings.json cites, written in the *same response* |
| gpt-4o-mini off r1 | 20 | 0 | 1 / 12 | yes | **8 / 0 (both source checks pass, run 77% → 100%)** | literal `\n` fused all URLs into one |
| gpt-4o-mini off r2 | 11 | 4 | 5 / 12 | yes | 5 / 4 | literal `\n` + under-listing |
| gpt-4o-mini on r0 | 11 | 4 | 4 / 12 | yes | 4 / 6 | literal `\n` + under-listing |
| gpt-4o-mini on r2 | 8 | 4 | 9 / 13 | yes | 9 / 2 | literal `\n` + 2 orphans |
| qwen3:4b off r0 | 10 | 4 | 9 / 1 | no | n/a | miscopied URL: wrote `github.com/WASI/WASI/...Preview2.md`; the real `github.com/WebAssembly/WASI/blob/main/docs/Preview2.md` was **visible in the preview head** on that turn |

- **Literal `\n`.** All 5 gpt-4o-mini lh-1 failures wrote `report.md` and `sources.md` with literal backslash-n and no real newline. The 1 gpt-4o-mini pass did not. The model emitted `\\n` itself: the parsed arguments in `llm-exchange.response.toolCalls` already contain it. The grader's URL regex `https?://[^\s)\]"'<>]+` does not stop at a backslash, so adjacent URLs fuse into one. 1 llama3.2:3b run shows the same defect: unescaping fixes its source checks (1 → 8 distinct), but the run fails other checks.
- **Under-listing.** gpt-4o-mini writes findings.json, report.md and sources.md in one parallel response. sources.md drops URLs that findings.json cites. The model had those URLs, so the defect is consistency, not evidence.
- **The rule's own `needs` field.** `ruleEvidenceTruncated` (`packages/trace/src/attribution.ts:476-493`) already lists `"which failed check depended on the elided or dropped content"` as missing. It fires on any elided result before the divergence turn. On this corpus it over-blames the harness 6 of 6 times.

### F4. Simulated budgets

The decisive-turn columns cover all 240 runs. "Hidden URLs" counts only results with a recorded full view. Prompt cost is lh-1 only, as added chars per render over the 1.2k baseline. Tokens are chars / 4 against the mean `tokensIn` per turn.

| budget | value at 32k / 128k | previews still cut at decisive turns | hidden URLs at decisive turns | truncation-caused failures removed | +chars/render lh-1: gpt-4o-mini / qwen3:14b / llama3.2:3b / gemma4 / cogito / qwen3:4b | +tokens/turn gpt-4o-mini |
|---|---|---|---|---|---|---|
| 1.2k fixed (now) | 1,200 / 1,200 | 141 | 276 (91 reach the deliverable anyway) | baseline | 0 | 0 |
| 2.5k fixed | 2,500 / 2,500 | 17 (http-get 2,836, file-read) | 0 | 0 | 1,238 / 597 / 678 / 364 / 134 / 120 | +310 (+7.1%) |
| 4k fixed | 4,000 / 4,000 | 1 (file-read 4,624) | 0 | 0 (1 partial, below) | 1,238 / 597 / 678 / 416 / 150 / 120 | +310 (+7.1%) |
| 5% of window | 6,553 / 25,600 | 0 | 0 | 0 (1 partial) | 1,238 / 597 / 678 / 442 / 150 / 120 | +310 (+7.1%) |
| 10% of window | 13,107 / 51,200 | 0 | 0 | 0 (1 partial) | same as 5% | +310 (+7.1%) |

Token cost per turn at 2.5k: gpt-4o-mini +310 (+7.1%), qwen3:14b +149 (+5.1%), llama3.2:3b +170 (+3.9%), gemma4 +91 (+2.5%), cogito +34 (+1.4%), qwen3:4b +30 (+1.1%). Above 2.5k the cost stops growing on this corpus because no web-search result is larger than 2,456 chars. A window-fraction rule has no ceiling on 128k to 1M windows: it would let a single http-get of 164,800 chars through at 10% of 1M. That is the Phase-A 27% bloat case the separate per-result cap exists to prevent (`packages/reasoning/src/assembly/capability.ts:34-47`).

**The partial case.** In rw-4 (cogito:8b, verdict-h before-lh, 0%), the model wrote `export const enrichedPosts: EnrichedPost[] = [...]`. The posts list (2,836 chars) was cut because the 164,800-char comments fetch was the latest result. 4k, 5% and 10% would unhide the posts, and 2.5k would not. The comment counts still need the full 164k payload, which no budget covers (that needs write-by-ref or transform). So no simulated budget flips this run. In the other 10 rw-4 runs the posts list was full on the write turn.

**91 of 276 hidden URLs still reached the deliverable.** Escalation on the next turn, earlier full views and duplicate hits recover much of the cut. In the gpt-4o-mini traces, every search result cut on iteration 1 shows in full on iteration 2. The one-turn lag matters only when the model writes on the cut turn, which gpt-4o-mini does. Even then, the URLs it needed were visible (F3).

## Recommendation

1. **Do not change `toolResultMaxChars` now.** No fixed or window-fraction budget removes a measured failure, and every option adds prompt cost. If a later corpus shows a real miss, prefer a fixed floor of about 2.5k (it covers every 5-hit web-search, p100 2,456) over a window fraction, which has no ceiling on large windows.
2. **Optional structural ablation (kernel-warden).** Give the recency budget to every result from the *latest batch*, not only the last result (`packages/reasoning/src/assembly/stages/project-results.ts:103-128`, `isLatest`). This removes the parallel-sibling fresh cut (F1) and costs nothing on later turns, which still compress to 1,200. It changes prompts, so it needs an ablation: lh-1, k≥3, gpt-4o-mini + qwen3:14b + qwen3:4b, before/after, `h3/verdict.ts`. Expected result: no accuracy change and a small efficiency change. The fix is a coherence cleanup, not a lift claim, so it ranks below items 3 to 5.
3. **Attribution fix (harness-warden, my instrument, needs its own mission).** `ruleEvidenceTruncated` must not fire when the deliverable's needed tokens were visible on the divergence turn. For URL-shaped failures, test containment. Add a detector for written non-JSON files that contain literal `\n` and no real newline, attributed as `model:invalid-content` with a repairable flag. Then re-run `rax-diagnose attribute --all` on both corpora and report the before/after reason table.
4. **Literal-newline repair (tools-warden).** `file-write` should unescape content for non-`.json` paths that contain no real newline and two or more literal `\n` sequences. This is the same defect class as the 2026-11-06 inner-quote repair (`packages/tools/src/healing/value-shape-healer.ts`, `json-repair.ts`). On regrade it fixes the source checks in 2 runs and flips 1 run to pass.
5. **Adjacent: web-search call ceiling (kernel-warden, unmeasured).** `repetitionGuard` caps parallel-safe tools at `maxBatchSize` = 4 calls *per run* (`packages/reasoning/src/kernel/capabilities/act/guard.ts:445-448`). The distinct-arguments carve-out excludes parallel-safe tools (`guard.ts:480`). In lh-1, which has six questions, the 5th and 6th searches were refused in 20 of 48 runs, and 8 of those 20 still passed. The impact on outcomes is not established. Count the trigger before building anything.
