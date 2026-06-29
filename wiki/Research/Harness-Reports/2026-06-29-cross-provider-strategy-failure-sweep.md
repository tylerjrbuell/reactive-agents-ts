---
title: Cross-Provider × Strategy Failure-Mode Sweep
date: 2026-06-29
status: active
type: harness-report
tags: [failure-modes, providers, strategies, thinking-budget, output-ownership]
---

# Cross-Provider × Strategy Failure-Mode Sweep (2026-06-29)

Goal: enumerate the *widespread, major* failure modes across provider × strategy × harness
combinations, cluster them by root cause, and decide the engineering approach to fix at the root.
Method: static adapter+strategy audits (3 agents) + targeted empirical confirmation probe.
NOT chasing minor issues — looking for the bugs tanking robust agentic reasoning.

## Headline — ROOT BUG (empirically confirmed)

**Thinking-mode budget starvation.** The kernel's main reasoning call caps visible output by tier
(`think.ts:584` — `{ mid:2000, large:3000, frontier:4000 }`), but reasoning models spend hidden
thinking tokens *out of that same budget*, and no adapter sets a thinking-budget carve-out. Gemini
2.5 thinks **by default** with a **dynamic** budget that expands to consume nearly the whole
`maxOutputTokens` → the visible answer is starved/truncated.

Empirical (gemini-2.5-pro, hard logic puzzle, via `gemini-thinking-starve-probe.ts`):

| maxTokens | thoughtsTokens | visibleTokens | finishReason | result |
|-----------|----------------|---------------|--------------|--------|
| 1000 | 936  | 20  | MAX_TOKENS | truncated (no answer) |
| 2000 | 1904 | 64  | MAX_TOKENS | truncated (no answer) |
| 4000 | 3837 | 143 | MAX_TOKENS | truncated mid-sentence, never states the answer |

gemini-2.5-flash identical shape (1917 thoughts / 78 visible @ 2000 → MAX_TOKENS).
Difficulty-scaled: an *easy* prompt thinks little and answers fine (first probe, train problem,
616 visible @2000, end_turn) — so the bug bites hardest on exactly the hard tasks where the model
is needed. **This is the mechanism behind "Gemini struggles with tasks local models crush"**: local
(ollama) models have thinking OFF → 2000-4000 is pure answer; Gemini burns it on hidden reasoning.

Systemic, not Gemini-only (audit): anthropic never sets `thinking`/`budget_tokens` (A1), openai
never sets `reasoning_effort` (O1) — both **latent** because their thinking is OFF by default; they
would starve identically the moment thinking is enabled. Gemini is the one provider whose default
is thinking-ON, so it's the one that breaks today.

## Failure-mode inventory (clustered by root cause)

### Cluster A — Thinking-budget starvation  [PROVIDER × HARNESS] — ROOT, confirmed
- `think.ts:584` single "output tokens" budget conflates hidden-thinking + visible-answer.
- `gemini.ts:283-305` buildGeminiConfig sets `maxOutputTokens`, never `thinkingConfig.thinkingBudget`.
- `anthropic.ts` no `thinking` param (latent); `openai.ts` no `reasoning_effort` (latent).
- Compounding: 30s cloud timeout (`gemini/anthropic/openai`) vs 120s local — thinking is also slow.
- **Explains the user's whole observation. Highest leverage, smallest blast radius.**

### Cluster B — Silent empty-success / output-ownership  [PROVIDER × STRATEGY × HARNESS] — HIGH
- Adapter asymmetry: `gemini.ts:342-350, 539-549` surface non-OK finishReason as an error;
  `anthropic.ts:621-630` and `openai.ts:693-700` **silently** return empty-success on
  `max_tokens`/`content_filter`/refusal. Agent can't tell "blocked" from "finished".
- Strategy empty-output cascades (invariant `status==="completed" ⟹ output.length>0` not enforced):
  - `code-action.ts:268-277` status always "completed" even when lastResult is "".
  - `plan-execute.ts:1164-1172` all-steps-failed path ships "" as success.
  - `reactive.ts:268` ships null `pass.output` on no-synthesis termination.
  - `tree-of-thought.ts:642-651` finalOutput=null when bestLeaf undefined.
- Connects to known **FM-E3** (continuation-intent shipped as final answer, fix `ef0eb2be`) and the
  honesty-label noise — these slip through the seam *below* the verifier.

### Cluster C — Reasoning quality / grounding  [MODEL × HARNESS] — partly model-bound
- **FM-C1** shallow / red-herring reasoning — UNMITIGATED, no harness mechanism (qwen3:4b 5/5 grab
  the discount red herring instead of the real cause; verifier passes the wrong answer).
- **FM-C2** fabrication-on-retry — short grounded answer rejected → retry adds MORE fabrication.
- Fabricated measurements on adversarial no-op tasks (rw-6) — partly addressed by `.withFabricationGuard`.

### Cluster D — Cost opacity & tier-insensitivity  [HARNESS × STRATEGY] — MEDIUM
- Sub-kernel cost opacity: plan-execute / blueprint / reflexion / tree-of-thought understate real
  LLM-call counts (nested runPass/critique/analysis calls not accounted upward).
- `tree-of-thought.ts:435-461` batch-scoring fallback cost explosion (3-23×) when a thinking model
  truncates the batch score (itself a Cluster-A symptom).
- Tier-insensitive caps: `reflexion.ts:491` kernelMaxIterations hardcoded 3; local == frontier.
- Single-step short-circuits (`plan-execute.ts:421`, `blueprint.ts:393`) can ship raw tool JSON.

### Cluster E — Tool-disclosure fragility  [HARNESS × STRATEGY × MCP] — MEDIUM
- `relevantTools` forwarding is a *convention* (each strategy must call buildKernelInput correctly),
  not an invariant; a miss → lazy-prune hides MCP/user tools → model blind (prior GitHub-MCP regression).

## Known FM catalog cross-ref (from wiki, still open)
FM-A2 persistent FC failure (local), FM-B2 verify-loop never converges, FM-C1 (above), FM-C2 (above),
FM-D2 strategy-switch doesn't recover, FM-F1 dual compression uncoordinated, FM-H1 required-tool nudge
ignored (local). Note: the 2026-06-26 sweep **did not include Gemini**, so Cluster A is genuinely new.

## Recommended engineering approach (fix at root, in order)

1. **Cluster A first** — one coordinated change: in the provider adapters carve out a thinking budget
   so the visible-answer allowance is preserved (Gemini `thinkingConfig.thinkingBudget`; plumb
   `thinking`/`reasoning_effort` for anthropic/openai), and/or have `think.ts` size `maxTokens` as
   *answer-budget + thinking-budget* for thinking-capable models instead of a flat tier cap. Validate
   with the cross-tier bench gate (≥3pp ∧ ≤15%tok ∧ ≥2 tiers) including a Gemini cell. Highest leverage.
2. **Cluster B** — establish the output-ownership invariant in ONE seam (kernel terminate/verify) and
   port the non-OK-finishReason guard to anthropic/openai for 3-provider parity.
3. **Cluster D/E** — convention→invariant: propagate budget/tier down to sub-kernels + account cost up;
   make relevantTools forwarding structural.
4. **Cluster C** — separate track (model-bound + needs new grounding/red-herring mechanism).

## Fix shipped this session (Cluster A + B)

**A — Gemini thinking-budget starvation (root, the user's lead).** `gemini.ts`
`buildGeminiConfig` now, for thinking-capable models (`resolveCapability().supportsThinkingMode`),
sets an explicit bounded `thinkingConfig.thinkingBudget = clamp(answerBudget*4, 1024, 16384)` and
raises `maxOutputTokens = answerBudget + thinkingBudget` so the harness-requested answer budget is
reserved ON TOP of thinking. Applied to complete(), stream() and completeStructured() (shared helper).
- Empirical before→after (gemini-2.5-pro, hard puzzle, harness frontier cap 4000):
  before 3837 thinking / 143 visible → MAX_TOKENS (truncated, no answer);
  after 4255 thinking / 3117 visible → **finish=STOP, complete ~9800-char answer**.
- gemini-2.5-flash @2000 cap: before 78 visible (starved) → after 2192 visible, full solution.
- Non-thinking models (flash-lite) untouched: no thinkingConfig, maxOutputTokens unchanged.
- The flash budget is honoured as a hard cap; pro treats it as advisory and reasons to its natural
  ~4-5k appetite given headroom — the 16384 ceiling sits above that so it isn't truncated mid-thought.

**B — silent empty-success parity.** Ported gemini's non-OK-stop guard to anthropic + openai, on BOTH
the complete() and stream() paths (the kernel's reasoning loop uses stream()): a `max_tokens`/`refusal`
(anthropic) or `length`/`content_filter` (openai) finish with empty content + no tool calls now fails
with an explanatory `LLMError` instead of returning empty-success the agent can't distinguish from a
clean finish.

**Verification:** llm-provider 292/292 tests pass (was 288 + 4 new); ESM+DTS build clean. New tests:
`gemini-provider.test.ts` (+2 thinking-budget), `anthropic-nonok-guard.test.ts` (+2 complete/stream),
`openai-nonok-guard.test.ts` (+2 complete/stream). TDD red→green for each.

**Deferred (tracked, not done):** Cluster D/E (sub-kernel cost/tier propagation, relevantTools as an
invariant); Cluster C (red-herring/grounding, separate track); G2 30s cloud timeout vs 120s local
(thinking models can need >30s); Anthropic/OpenAI thinking-budget plumbing left OFF (enabling thinking
is a behavior change needing its own ablation — the budget math is now correct-when-enabled). Validate
Cluster A with the cross-tier bench gate (incl. a Gemini cell) as the next step.

## Bench gate + G2 (2026-06-29, follow-up)

Gated Cluster A with a cross-tier `ra-full` bench (`cluster-a-gate` session: gemini-2.5-flash,
gemini-2.5-pro, claude-haiku-4-5 control; deterministic regex-scored reasoning tasks).

- **Moderate cells (m2-word-problem, m3-sql-injection) = inconclusive.** Both 100% BEFORE (pre-fix
  gemini.ts) and AFTER. These tasks don't induce enough thinking to trip the starvation at the 2000/
  4000 cap — same as the easy-prompt probe. The fix's benefit is real but lives on HARD reasoning,
  which the moderate cells don't exercise. (Lesson: a gate task must be hard enough to make a thinking
  model actually think near the budget, or it can't discriminate the fix.)
- **Hard cells surfaced two COUPLED bugs, not starvation:**
  - `e1-lis-optimization` (strategy=tree-of-thought) → `ExecutionError: Expansion failed at depth 1`.
    Root: ToT expansion uses `llm.complete()`, which had a hard **30s timeout (G2)**. Letting Gemini
    think longer (the Cluster A fix) pushed the expansion past 30s → the fix's own benefit was being
    killed by the tight timeout. pro durations 36-38s confirm the 30s cap firing.
  - `e3-logic-fallacy` → 240s **cell** timeout (pro thinking × harness iterations); stream path has no
    per-call timeout so it ran to the cell bound. Separate efficiency issue (see below).

**G2 FIXED + verified.** Raised cloud `complete()` timeout 30s → 120s (matching local) across
gemini/anthropic/openai/litellm. Re-ran e1 on gemini-2.5-pro: **"Tree-of-thought completed
successfully"** (338s, 26698 tok) where it previously crashed at the expansion. llm-provider 292/292
green, build clean. G2 is the latency-coupled companion to Cluster A: without it, completing answers
on hard tasks just trades truncation for a timeout.

**Still open (prioritized next):** e3-style runaway — slow thinking models (pro) burn the whole cell
budget on iterations; needs a per-call stream timeout and/or tighter iteration economy for slow tiers.
Then Cluster B strategy-side (output-ownership invariant) and D (sub-kernel cost/tier propagation).
A proper Cluster-A lift number needs a HARD deterministic reasoning task (zebra-puzzle, exact-match)
added to the bench so the moderate-cell inconclusiveness is replaced by a discriminating cell.

## Cross-tier stress map + output-ownership invariant (2026-06-29, follow-up 2)

Ran a `cross-tier-stress` map: 7 models across all 4 providers/tiers × 5 challenging tasks spanning
react / plan-execute / tree-of-thought, deterministic scoring, ra-full. The harness is broadly healthy
post-fixes — most cells pass. Failures concentrated and ALL shared one signature: **empty final output**.

| cell | strategy | status | tokens | output |
|------|----------|--------|--------|--------|
| gpt-4o-mini / c4-db-decomposition | react | done/pass | **22418** | **`""`** |
| sonnet / c4-db-decomposition | react | done/pass | 696 | `""` |
| qwen3:14b / e3-logic-fallacy | tree-of-thought | error | 0 | `""` (300s cell timeout) |
| gemini-2.5-pro / e3-logic-fallacy | tree-of-thought | error | 0 | `""` (300s cell timeout) |

The gpt-4o-mini case is the tell: **22418 tokens of real work, status=done, output empty** — the harness
threw the answer away. Cross-cutting (react + ToT, 4 providers).

**Root cause (trace-confirmed).** Empty-output runs terminate via
`terminatedBy="controller_early_stop:dispatcher_early_stop"` (set by `arbitrator.ts:937`,
`controller_early_stop:<reason>`). The harness-deliverable synthesis (`runner.ts §8.5`) keys off a
NARROW terminatedBy whitelist that contains the hyphenated sentinel `"dispatcher-early-stop"` (set by a
*different* producer, `reactive-observer.ts:390`) — **not** the arbitrator's `controller_early_stop:*`
value. String-format mismatch → §8.5 never assembles → the run reaches the verifier with empty output
despite substantive artifacts. (The max-iter stall path works — it stamps `harness_deliverable` — which
is why only the arbitrator early-stop leaked.)

**Fix (output-ownership invariant, `runner.ts §8.8`).** Rather than patch the brittle string, added a
GENERAL fallback immune to terminatedBy drift: `status==="done" && !state.output &&
countDeliverableCandidates(state) > 0 → commitDeliverable(assembleDeliverable(state))`. Additive (fires
only when output is empty, so it can't override a path that produced output); routes through the
single-writer `commitDeliverable` + existing `assembleDeliverable` synthesis chain (lastThought →
validated observations → concatenated). Establishes the invariant: **a done run with deliverable
artifacts never ships empty output.**

**Verification:** RED test reproducing the arbitrator early-stop empty-output (output len 0) → GREEN
after the fix (output synthesized from the observation). reasoning suite **1808/0**. Empirical c4 re-run
pending (gpt-4o-mini + sonnet → non-empty output).

The two e3 ToT 0-output cells are a SEPARATE cause (external 300s cell timeout kills the process before
synthesis) — needs the ToT wall-clock budget (the §8.8 invariant can't help when the process is killed
mid-work). Tracked, deprioritized per "framework over niche-strategy" steer.

## Probe artifact
`.claude/skills/harness-improvement-loop/scripts/gemini-thinking-starve-probe.ts`
(stream path, RA_GEMINI_DEBUG=1 prints per-chunk thoughts/visible/finishReason; PROBE_MODEL + PROBE_BUDGETS env).
