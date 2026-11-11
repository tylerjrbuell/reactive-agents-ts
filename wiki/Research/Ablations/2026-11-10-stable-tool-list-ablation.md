---
type: ablation
status: complete
created: 2026-11-10
tags: [ablation, lift-gate, stable-tool-list, tool-surface, answer-turn, exit-gate, prompt-cache, opt-in]
---

# Ablation: `stableToolList` vs shipped default (grok-4, mimo-v2.6 at 16k and 8k). Verdict OPT-IN

Design and census: [[../Harness-Reports/2026-11-10-tool-surface-leading-practice]] §4, §6, §7. Predictions were written before the first measured cell: [PREDICTIONS.md](2026-11-10-stable-tool-list/PREDICTIONS.md). Scripts, receipts and results: [2026-11-10-stable-tool-list/](2026-11-10-stable-tool-list/).

## Verdict

Coded gate (`evaluateLiftGate`, `DEFAULT_LIFT_POLICY`; Ollama tiers token-free per the 2026-11-06 owner ruling; ledger entry written):

```
  tier                 base    cand      lift       tok  verdict
  grok-4               81.2    78.9    -2.3pp    +17.9%  INCONCLUSIVE   (billed +27.9%)
  mimo-v2.6@16384      58.8    60.5    +1.8pp     +8.0%  INCONCLUSIVE
  mimo-v2.6@8192       56.7    50.0    -6.7pp     -6.5%  BELOW
  DECISION: OPT-IN · 3 tier(s) · inconclusive tier blocks promotion
```

- Two tiers read INCONCLUSIVE only because `rw-3` and `h3-plan-only` (plan-execute) have more than 20 % timed-out runs. The mechanism cannot act on those tasks: no run on either tier emits a tool-surface event there. The printed aggregate (−6.7 pp) covers only the one conclusive tier.
- Sensitivity, same data without the three tasks that have no tool surface (`rw-3`, `h3-plan-only`, `ab-trap-4`): every tier is BELOW: grok-4 −2.1 pp at +32.3 % billed tokens, mimo@16k −1.4 pp at +12.1 %, mimo@8k −6.7 pp at −6.5 %. Aggregate −3.4 pp; within noise. Receipt: `gate-receipt-sensitivity-surface-tasks.txt`.
- Counting Ollama tokens does not change the decision (`gate-receipt-all-tokens-counted.txt`).
- No tier regresses beyond the noise band, so this is not a REJECT. No tier shows lift, and on grok-4 the token overhead exceeds the 15 % bar.

**Recommendation: keep `stableToolList` opt-in. Do not default it on.** It does what it claims: the wire list stops changing within a run. On these tasks, that produced no measurable gain in success, latency or cache. On the frontier tier it costs tokens, because it ships two meta tools that the default never ships there.

## Setup

- **Arms.** `base` = shipped default. `stl` = same plus `RA_STABLE_TOOL_LIST=1`. Within one process, arms alternate per (run, task), so each pair runs on the same build.
- **Tiers.** `grok-4` (xAI, static capability). `mimo-v2.6` (Ollama), capability primed from `/api/show`, with `num_ctx` passed explicitly through `.withModel({ model, numCtx })`: 16384 for H3 and the wide tasks; 8192 (tight) for the wide tasks. The bench has no `numCtx` seam, so `run-h3-stl.ts` patches `withModel` for this model only. Anthropic was not used.
- **Tasks.**
  - The frozen H3 suite (12 tasks; 1 to 4 builtins each).
  - `wide-metric`: 40 MCP-like tools, 2 of them needed.
  - `umami-explore`: 20 umami-style tools; the open-ended prompt from the Cortex case, "Help me explore analytics for my docs site in umami".

  The two wide tasks run through `run-wide.ts`, because the bench has no custom-tool seam. Their scores are deterministic: needed tools called plus the sentinel value present (`wide-metric`); 3 tool-only facts present in the output the caller received (`umami-explore`).
- **Runs.** grok-4: k = 5 on everything. mimo: k = 3 on H3, k = 4 on `h3-plan-only` (one cell timed out), k = 5 on the wide tasks. Cell walls: 150 s (grok H3), 200 s (mimo H3), 60 to 120 s (wide).
- **Exclusions.** These are the only edits to measured rows, and both arms get them (`prep.ts`):
  - mimo `rw-3` ran once per arm and was then dropped. It runs 10k-token thinking calls, hits the 200 s cap, and has no tool surface.
  - Wide-task timeouts are marked inconclusive, the same way the H3 runner marks them.
- **Git state.** HEAD `69aa37a6a` plus a dirty tree: 230 files, other wardens editing `packages/reasoning` and `packages/runtime`. Builds:
  - 17:06: my `build:packages`.
  - 17:29 and 17:58: `reasoning/dist` rebuilt by others.

  `runtime` resolves `src`, so its edits applied live. Of the H3 cells, 31 (base) and 32 (stl) of 94 per arm ran before 17:29. Every wide-task cell ran after. Arms are interleaved, so a pair almost always shares a build, but absolute rates mix builds. Raw traces: `~/.reactive-agents/ablations/2026-11-10-stable-tool-list/`.

## Tool surface per arm (printed before any token reading)

Turn-0 lists, one representative per task shape. Full table: `surface-all.txt`.

| Tier | Task | Arm | visible (turn 0) | shipped on the wire (turn 0) |
|---|---|---|---|---|
| grok-4 | rw-2 | base | file-read, file-write | file-read, file-write |
| grok-4 | rw-2 | stl | file-read, file-write, recall, discover-tools, final-answer | file-read, file-write, **recall, discover-tools** |
| grok-4 | umami-explore | base | umami_get_websites, discover-tools | umami_get_websites, discover-tools (19 of 20 umami tools not shipped) |
| grok-4 | umami-explore | stl | umami_get_websites, recall, discover-tools, final-answer | umami_get_websites, **recall**, discover-tools |
| grok-4 | wide-metric | base / stl | 12 / 14 | 12 / 13 (stl adds recall) |
| mimo@16k | rw-2 | base | file-read, file-write | file-read, file-write, recall |
| mimo@16k | rw-2 | stl | file-read, file-write, recall, final-answer | file-read, file-write, recall |
| mimo (both ctx) | umami-explore | base / stl | 1 / 3 | 21 / 21 |
| mimo (both ctx) | wide-metric | base / stl | 11 / 13 | 41 / 41 |

**`visible` is not the wire list on mimo.** With `toolIndex` on (local tier), hidden tools are promoted onto the wire (`buildToolIndexCallableSchemas`, `think.ts`). So mimo ships about 40 schemas on `wide-metric` while `visible` lists 11. Read `guard-fired wire-request` `toolsShipped`, not `tool-surface-resolved.visible`. The census figure "tool list changes within a run in 40 % of runs" was read from `visible`.

### Within-run changes to the shipped list

| Tier | base: changes (runs with ≥1) | stl: changes (runs with ≥1) |
|---|---|---|
| grok-4 | 0 in 69 runs (0) | 2 in 70 (2, both discovery appends) |
| mimo@16k | 39 in 44 runs (37) | 0 in 44 (0) |
| mimo@8k | 10 in 10 runs (10) | 0 in 10 (0) |

- On mimo, the default adds or drops `recall` on the wire mid-run in 84 % of runs. stl removes that completely.
- On grok-4, the default's wire list was already constant: `visible` changes, but only `final-answer`, which is never shipped. There is nothing for stl to fix there. stl ships `recall` + `discover-tools` from turn 0 on every narrow task, where base ships neither.
- The never-prune fallback (36 tools pinned on turn 0) did not trigger in any run. Its cost is untested here.

## Cost, cache, latency

| Tier / suite | billed tokens stl vs base | prompt-cache read / input tokens (base, stl) | LLM call median ms (base, stl) | wall per run s (base, stl) |
|---|---|---|---|---|
| grok-4 H3 | +27.9 % (gate) | 29.8 %, 23.8 % | 2838, 3111 | 18.8, 23.7 |
| grok-4 wide | (in the above) | 55.6 %, 53.3 % | 2406, 1932 | 6.3, 6.3 |
| mimo@16k H3 | +8.0 % (gate, all mimo@16k) | not reported by Ollama | 3478, 3187 | 32.2, 28.0 |
| mimo@16k wide | | not reported | 1320, 1308 (later calls 2671, 1587) | 19.3, 11.9 |
| mimo@8k wide | −6.5 % (gate) | not reported | 1463, 933 (later calls 1834, 2487) | 8.6, 7.7 |

- **Cache.** On grok-4, the prompt-cache read share went down under stl (29.8 to 23.8 % on H3). Stability brought no cache gain, because the default list was already stable on that tier.
- **Latency.** mimo is mostly faster under stl, which fits Ollama reusing the KV prefix when the tool block is stable. It is not consistent, though: mimo@8k later calls are slower. Run lengths differ, and n is small. Not claimable.

**Not-ready refusals** (`guard-fired`, `metadata.kind: "not-ready"`; stl only):
- grok-4: 6 (`recall` ×4, `discover-tools` ×2).
- mimo@16k: 10, all `recall`; 6 of them on turn 0 ("nothing is saved yet").
- mimo@8k: 0.

Listing `recall` from turn 0 invites a call that cannot work yet. The refusal costs one short observation per call. In one `rw-9` run mimo made it 3 times.

**Other counts.**
- Blind `recall` `found:false`: 0 in both arms.
- `discover-tools` calls: 2, both grok-4 stl on `umami-explore`. They are what let those two runs gather data.
- Head-truncation guard fired once, on mimo@16k base `umami-explore`.

## Answer turn (default-on, no off switch: outcome evidence, not an A/B)

**Frequency.** The answer turn was taken in 8 of 248 runs (base 4, stl 4). It is rare on these tasks.

| What the model did on the tool-less call | Runs | Final status |
|---|---|---|
| Wrote an answer | 5 | 5 `success`, model-authored. Task scores 0.67, 0, 0, 0, 0 |
| Emitted a tool call anyway (mimo) | 2 | 2 `failure` (`stall_deliverable`, `dispatcher-early-stop`), no model answer |
| Cell timed out before the call returned | 1 | none |

- **Partial.** None ended `partial`.
- **Failed with evidence.** No run ended "failed with evidence": both failures carry `provenance: none`.
- **Accepted wrong answers.** Three of the model-authored `success` answers are `rw-7` claims ("all bugs fixed, `bun test` exits 0"). The hidden test check scores them 0, yet the run is reported `success` / `model-final`.

**Comparison with earlier traces (not an A/B; different tool server, window and harness build).** The first trace in `~/.reactive-agents/traces` with an `exit-gate-answer-turn` event is from 16:32. The closest comparison is the Cortex mimo-v2.6 umami runs.

| Period | Runs | Outcome |
|---|---|---|
| Before 16:32 (14:24-16:30, 8k-32k ctx) | 7 completed | 0 success. 4 ended with a harness-written answer and `runtime-success-veto` (e.g. `01M73FK911…`, `01M73FTG2J…`). 2 `llm_error`. 1 `max_iterations` |
| After 16:32 (mimo `01M73QV9P6…`, `01M73RMH4Z…`; grok `01M73QB8QP…`) | 3 | 3 success, `model-final` |

- None of the three later runs took an answer turn, so their success cannot be credited to it.
- In this ablation, `umami-explore` took an answer turn in 1 of 40 runs.

## Harness defects found (report to the owning wardens; not fixed here)

1. **Derived numbers blocked as fabricated measurements** (verification). `output-not-fabricated-measurement` blocks unit conversions of tool values. Example: 611,400 s reported as "10,190 minutes" or "169.8 hours".
   - It failed all 10 mimo@8k `umami-explore` runs and both grok-4 stl runs that gathered data. The answers were otherwise good.
   - Some conversions really were wrong ("167 hours", "172.6 hours"), so the check is half right. The correct ones are blocked too.
2. **Claimed actions not checked** (verification). mimo on `wide-metric` calls only `metrics_fetch`, writes "I've filed a report", and the run is accepted as `success` / `model-final`. This happened in 12 of 20 mimo runs (8 of 10 at 8k, 4 of 10 at 16k), in both arms.
3. **Answer turn issues** (kernel).
   - On the tool-less answer-turn call, mimo still returned a tool call 2 of 7 times; both runs then failed with no answer.
   - Model-authored answers on answer turns end `success` even when the gate had just denied an exit for outstanding items and the hidden check scores them 0.
4. **Lazy disclosure on frontier tiers hides most of an MCP-sized roster** (kernel, tool surface). grok-4 `umami-explore` ships 1 of 20 umami tools plus `discover-tools`. In 5 of 5 default runs the model asked the user what to look at. That may be fine for chat, but it scored 0.
5. **Compact profile drops tool descriptions** on the local tier. mimo never sees the valid `type` values (`url`, `referrer`) that the description lists, so it asks `umami_get_metrics` for `pageviews`. That caps its `umami-explore` score at 0.33 in both arms. The task and the harness share the blame: an enum would survive the stripping.
6. **Instrument.** `tool-surface-resolved.visible` is not the wire list when `toolIndex` promotes hidden tools. Within-run list-change statistics should be read from `wire-request.toolsShipped`.

## If `stableToolList` is reworked

- Do not pin `recall` / `discover-tools` into the turn-0 list where the default does not ship them (frontier tiers). That is all of the grok-4 token overhead, plus most of the not-ready refusals.
- The mechanism only changes wire behaviour on tiers where the default churns the wire list. Here that was mimo, via the `recall` floor and the overflow gate. A narrower fix: keep `recall` on the wire for the whole run on those tiers, and do nothing elsewhere.
- Measure the prompt-cache effect on a provider that reports it, on a tier where the default actually churns (Anthropic, or OpenAI with a local-tier profile). grok-4 does report cache reads, but its default list does not churn.

## Not proven

- n = 3 to 5 per cell. Cell bands are ±22 to 40 pp, so only effects above about 25 pp per task could be resolved.
- The harness changed under the measurement (three builds; live `runtime` edits). Pairs are interleaved, but absolute rates mix builds.
- The 36-tool turn-0 fallback cost was not exercised.
- The answer-turn evidence is 8 runs, and the earlier-trace comparison is not controlled.
