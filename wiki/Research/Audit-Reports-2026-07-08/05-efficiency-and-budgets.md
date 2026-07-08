# Architecture Sweep 2026-07-08 — 05-efficiency-and-budgets

**Mission:** long-horizon spend audit — budget awareness, re-execution waste, batching, right-sized model calls.
**Builds on:** [[../Audit-Reports-2026-07-07/03-provider-model-params|03-provider-model-params]] (F1 output-clamp — now shipped in gateway/provider split per llm-gateway.ts:13-22 header) and [[../Harness-Reports/2026-07-07-a2-harness-tax-decomposition|A2 harness-tax]] (F1 traceContext, F2 thinking-starvation → gateway Phase 1 shipped; F3 re-execution → P4 carryover shipped — residuals verified below).
**Method:** read-only source audit. No bench runs. All line numbers verified against `main` 2026-07-08.

---

## Headline verdicts (the four priority questions)

1. **Budget warn behavior: warn = log line.** `BudgetSignal.status="warning"` at ≥0.80 of tokenLimit/costLimit flows to exactly ONE consumer: `emitBudgetSignalCollected` (a diagnostics trace event, `arbitrator.ts:1422-1433`, called from `iterate-pass.ts:694` via `arbitrateAndApplyWithBudgetEmit`). The doc comment "downstream consumers (e.g., RI dispatcher) may react" (`arbitrator.ts:551`) is aspirational — grep finds no dispatcher, gateway, compressor, or prompt consumer. Nothing compresses harder, nothing routes cheaper, nothing triages, and the model is never told. The next state after "warning" is the cliff: `exceeded` → `exit-failure terminatedBy="budget_exceeded"` (`arbitrator.ts:1011-1027`) — mid-task, answer discarded.
2. **Budget ∝ remaining work: NONE.** `ArbitrationContext` carries both `budget` (BudgetSignal) and `postConditions` (`arbitrator.ts:658, 675`) but no code relates them. There is no "3 requirements left + 10% budget → triage" mechanism anywhere. The only remaining-work-aware mechanics in the kernel are iteration-count-based: think-guards stop redirect-nudges on the last iteration (`think-guards.ts:195,273`) and `iterationsRemaining` feeds abstention legitimacy (`think.ts:1172-1183`, `abstention-legitimacy.ts:25`). Seam proposal in §Phase-6 below.
3. **Gateway budget classes are NOT goal-aware.** `LlmCallIntent` = `{purpose, budgetClass, budgetTokens, tier, thinkingModel}` (`llm-gateway.ts:63-78`) — no field for run state, remaining budget, or "this is the final deliverable." Classes are chosen statically at each code site. `generous` (8192) has **zero call sites** — the class exists but is unreachable. The universal end-of-loop re-synthesis is classed `terse` (2048).
4. **Model routing is run-scoped, not phase-scoped.** `cost-route` picks ONE `ctx.selectedModel` per run before the loop (`cost-route.ts:38-84`). No per-call routing exists: the gateway only sets `maxTokens`, never `request.model` — even though `CompletionRequest.model` is a per-request field, so the seam already exists and is unwired. Gathering iterations and final synthesis always run on the same model; so do all aux calls (classify/extract/verify/debrief).

---

## Finding table

| # | Mechanism | file:line | Long-horizon behavior today | Waste / risk | Fix direction (phase map) |
|---|---|---|---|---|---|
| E1 | Gateway budget classes | `reasoning/src/kernel/llm-gateway.ts:61,101-115` | terse=2048 / standard=4096 / generous=8192, chosen statically per code site; purpose defaults (classify/verify→terse, rest→standard). No goal- or run-state input. | Final synthesis of a 25-iteration research run gets the same budget as iteration 2's. `generous` unreachable (0 call sites). | Add `finalDeliverable?: boolean` + `runPace` to `LlmCallIntent`; policy compiler (Phase 6) owns class modulation. |
| E2 | Mis-classed synthesis sites | `kernel/loop/finalize.ts:147` (terse=2048); `kernel/loop/runner.ts:1018,1155` (terse); `runtime/src/chat.ts:201` (1024) | `finalize.ts:147` is EVERY run's end-of-loop re-synthesis — the deliverable — capped at 2048. Runner's grounding-corrected (1018) and forced (1155) synthesis likewise terse. | Long-form multi-section answers truncated or thin at exactly the moment the run's whole spend should pay off. Worst single mis-class in the codebase. | Reclass final-deliverable synthesis to `generous` (or tier-adaptive); keep terse for correction-style rewrites. Phase 6 policy, but a 1-line interim fix is defensible after bench. |
| E3 | BudgetLimits / BudgetSignal | `kernel/capabilities/decide/arbitrator.ts:527-615` (warn=0.80 `:565`), guard `:1011-1027`; opt-in via `.withBudget` `runtime/src/builder/withers/model-budget.ts:70-86` | ok → warning (log event only) → exceeded (hard exit-failure). Opt-in; no defaults. | Binary cliff: zero adaptation band. A run at 79% budget behaves identically to one at 5%; at 100% the answer-in-progress is discarded as failure. | Make `warning` actionable (see Phase-6 policy): compress, downshift class, triage, then terminal-synthesize BEFORE exceeded fires. |
| E4 | Budget↔work coupling | `arbitrator.ts:623-676` (ArbitrationContext has `budget` + `postConditions` side by side) | NONE — never cross-read. | No triage: run burns remaining 20% budget on requirement 1 of 3 instead of cheapest-first or synthesize-what-we-have. | New pure fn next to `computeBudgetSignal`: pace = f(burnRatio, unmet postConditions). Phase 6 input. |
| E5 | P4 carryover residuals | `kernel/loop/runner-helpers/strategy-switch.ts:149-169` | Shipped: last **8** successful observations + `toolsUsed` set carried. NOT carried: `scratchpad` (fresh `initialKernelState` — `_tool_result_N` full tool results lost), messages thread, plan state. | (a) Post-switch grounding corpus sees only compressed previews → false grounding rejections on items 6-N (the exact bug `ArbitrationContext.scratchpad` doc `:643-649` warns about); (b) plan-execute/blueprint regenerate a full plan via LLM from scratch (`purpose:"plan"`, ~4096); (c) 8-obs cap drops evidence on runs with >8 successful tool calls. Classification is NOT re-run (run-scoped, `runtime/src/engine/phases/agent-loop/setup/classifier.ts:152`) — good. | Carry `scratchpad` map across switch (cheap, pure); make obs-cap proportional to run length; seed new strategy's planner with carried observations as evidence, not just 9-line text handoff. Phase 3-4 (ledger/control-plane) territory. |
| E6 | Batch tool execution | `decide/tool-gating.ts:218-255` (planNextMoveBatches), `act/act.ts:302-314,608-637` | Fires only when the model natively emits multiple tool calls in ONE turn. Default on, `maxBatchSize:4` (`types/config.ts:88`). Parallel-safe = name heuristic (`tool-gating.ts:106-138`: search/http/fetch/get/read/list/query + spawn-agent(s)/recall/find/shell-execute; write/delete/update/create/META unsafe). Execution genuinely parallel: `Effect.all` with `concurrency: executableCalls.length` (`act.ts:637`). | Fan-out of 5 searches parallelizes ONLY if the model emits 5 calls in one turn (→ 4∥ then 1; batches serial between groups). Weak/local models rarely emit multi-calls and nothing in the prompt asks them to — no "issue parallel calls together" nudge exists. Required-tools gate returns only the FIRST required batch (`tool-gating.ts:340-345`) and non-strict mode trims to 1 exploratory call (`:365`). | Prompt-side fan-out nudge for parallel-safe purposes when >1 gathering step remains; strategy-side: blueprint already splits parallel-safe steps (`strategies/blueprint/worker.ts:463-466`) — the reactive kernel is the gap. |
| E7 | Model routing | `runtime/src/engine/phases/cost-route.ts:38-84`; tiers in `@reactive-agents/cost` | Opt-in `.withModelRouting`, advisory, ONE model per run from task-text complexity (`chars/4` estimate incl. system prompt, `:70-71`), window-gated, `tierModels` overrides, `minTier` floor. | All 6 gateway purposes hit the same model: classify (terse routing decisions) pays frontier price; synthesis on a cheap-routed run can't escalate. Long-run gathering/synthesis split is possible but unwired. | Wire purpose→tier map in the gateway (set `request.model`), gated by existing `modelRouting.tierModels` so it stays opt-in + capability-gated. Phase 6 action. |
| E8 | Meta-tool overhead | dedup guard `act/guard.ts:227-258`; counter update `act/act.ts:404-405,792-798`; INTROSPECTION set `state/kernel-constants` | Blocks only the 3rd+ **consecutive identical** meta call (`count >= 2`). Counter resets to 1 on name change, 0 on any non-meta call. | Alternating `brief→pulse→brief→pulse` is never blocked — each ping costs a full LLM turn on the iteration budget. Blocked calls still cost the turn that proposed them (post-hoc observation, not prompt-side removal). On a 10-iteration default run, 3 meta pings = 30% of the ceiling. | Widen dedup to "N meta calls in any window without an intervening domain action"; or charge meta turns fractionally against maxIterations. Phase 2 tool-surface resolver is the natural home (it already owns per-iteration visibility + reason map, `reason/tool-surface.ts:1-37`). |
| E9 | Iteration ceiling economics | builder default 10 (`runtime/src/builder.ts:237-241`, env `REACTIVE_AGENTS_MAX_ITERATIONS`); bench `benchmarks/src/runner.ts:103` (`?? strategy?15:5`), runInternal `:618` (`?? reasoning?20 : tools?15 : 1`); tasks hand-set 8-25 (`task-registry.ts`, `tasks/real-world.ts`) | maxIterations is the only universal long-horizon knob. Count-based: an iteration costs anywhere from ~200 tokens (meta ping / blocked call) to ~20k (widened thinking synthesis). Three uncoordinated default formulas (builder 10, bench 15/5, runInternal 20/15/1). | Ceiling is a proxy for spend that doesn't measure spend. Bench tasks needing 25 iterations get them by hand-tuning, not by task-size derivation. No default time or token budget accompanies it (timeoutAfter/watchdog/budgetLimit all opt-in). | Phase 6: derive ceiling from budget (tokens ÷ expected-per-iteration for tier) instead of vice-versa; unify the three default formulas into the policy compiler. |
| E10 | Structured-output retry budget | `structured-output/pipeline.ts:189-206` + retry loop `:249-260` | Retries (default maxRetries) reuse the IDENTICAL `budgetTokens: maxTokens` — no `stopReason` check, no escalation, no fail-fast on empty-content+max_tokens. A2-F2's remedy #1 was NOT shipped; only the provider-level num_predict widening (P1) mitigates it for local thinking models. | The A2 measured worst case (3 × 115s deterministically-identical failures = 91% of a run) is still structurally possible on any provider/path the widening doesn't cover. | Ship A2 remedy #1: after `stopReason==="max_tokens" && stripThinking(content)===""`, fail fast or bump budget on next attempt only. Small, zero-risk, pre-Phase-6. |
| E11 | Cost-package budgets (context) | `cost/src/budgets/budget-enforcer.ts:21-60` | Separate mechanism: perRequest/perSession/daily/monthly USD caps, pre-call `check()` fails with BudgetExceededError. | Two budget systems (cost enforcer, arbitrator BudgetSignal) with no shared state or pace concept; neither adapts, both only refuse. | Phase 6 should treat the enforcer as the wallet and BudgetSignal as the in-run pace signal — one policy reading both. |

**Verified-fixed from prior reports (do not resurface):** 12 flat-literal call sites now route through `gatewayComplete/gatewayStream` with enforcement script (`scripts/check-llm-gateway.sh`, header llm-gateway.ts:28-30); `traceContext` threaded in pipeline (`pipeline.ts:205`); B2 tier think-budgets moved verbatim into gateway (`TIER_THINK_BUDGET` local:1200/mid:2000/large:3000/frontier:4000 + `THINK_MODEL_ALLOWANCE` 6000, `llm-gateway.ts:85-99`); capability `maxOutputTokens` clamp now provider-side per the gateway's division-of-labor note (`:13-18`).

---

## Gateway call-site census (goal-awareness lens)

| Site | Intent | Long-horizon verdict |
|---|---|---|
| `think.ts:598` (main loop) | `think` + tier + thinkingModel | OK — tier-adaptive, bench-validated |
| `finalize.ts:147` | `synthesize` + **terse** | **Mis-classed** — universal final re-synthesis at 2048 |
| `runner.ts:1018,1155` | `synthesize` + **terse** | Mis-classed for long deliverables (grounding-fix + forced synth) |
| `plan-execute.ts:443,1079`, `step-executor.ts:269`, `blueprint.ts:507`, `blueprint/worker.ts:314` | `synthesize` standard (4096) | Under-sized when evidence volume is large; no way to say "final synthesis, spend generously" |
| `reflexion.ts:237`, `code-action.ts:122,247` | provider-default | Legacy escape hatch — budget decided by provider config, invisible to policy |
| `adaptive.ts:183`, `strategy-evaluator.ts:144` | `classify` (terse) | Right-sized |
| `tool-execution.ts:867` (extractObservationFacts), `pipeline.ts:202`, `debrief.ts:294` (512), `chat.ts:201` (1024) | `extract`/explicit | OK except pipeline's fixed-across-retries budget (E10) |
| `critique.ts:93`, `tree-of-thought.ts:348,421,457` | verify/computed | OK (ToT uses budgetTokens escape hatch for breadth math) |

---

## Phase 6 proposal — budget-aware long-horizon policy (for the policy compiler)

All inputs already exist as pure signals; the policy is a compile-target, not new machinery.

**Inputs**
- `BudgetSignal` — tokensUsed, costUsd, tokenLimit, costLimit (`arbitrator.ts:554-562`)
- `iterationsRemaining` = maxIterations − iteration (`runner.ts:662`, `think.ts:1172`)
- Unmet `postConditions` count / total (`state.meta.postConditions`, `arbitrator.ts:675`)
- Missing `requiredTools` count (`getEffectiveMissingRequiredTools`)
- `tier`, `thinkingModel` (context profile), `modelRouting.tierModels` (if configured)
- Elapsed vs `timeoutAfter` when a compose time killswitch is armed

**Derived (one new pure function beside `computeBudgetSignal`)**
- `burnRatio` = max(tokens/tokenLimit, cost/costLimit, iteration/maxIterations, elapsed/timeout) — max over the declared dimensions only
- `workRatio` = unmetPostConditions / totalPostConditions (fallback: missingRequired / required)
- `pace` ∈ {green, economize, triage, terminal}

**Thresholds (grounded in existing constants)**
- green: burnRatio < 0.60
- economize: 0.60 ≤ burnRatio < 0.80 (new band under the existing warn line)
- triage: 0.80 ≤ burnRatio < 0.95 — reuses `DEFAULT_BUDGET_WARNING_RATIO = 0.80` (`arbitrator.ts:565`) so "warning" finally means something
- terminal: burnRatio ≥ 0.95 OR iterationsRemaining ≤ 1 — extends the existing last-iteration defer (`think-guards.ts:195,273`)

**Actions per band**
- *economize:* non-final gateway purposes drop one class (standard→terse); `toolResultMaxChars` tightens (from profile 800, `runner.ts:231`); prompt nudge to emit parallel-safe calls together (activates E6's existing `Effect.all` path).
- *triage:* inject one steer line ("K of N requirements met; ~20% budget remains — finish the highest-value requirement, then synthesize"); flip `strictDependencyChain` on (blocks exploratory singles, `tool-gating.ts:359-361`); route classify/extract/verify purposes to the cheapest capable `tierModels` entry via `request.model` (E7 seam) — gated on modelRouting being configured.
- *terminal:* force the synthesis path NOW with `budgetClass: "generous"` (making the unreachable 8192 class the deliverable's budget) and skip aux verify/critique calls; this converts today's `budget_exceeded` exit-failure cliff into a degraded-but-delivered answer, matching the forced-abstention philosophy (§7.5) of "honest partial > silent failure."

**Wiring (minimal surface)**
1. `LlmCallIntent` gains `runPace?` and `finalDeliverable?: boolean` — `resolveOutputBudget` modulates class by at most ±1 step, keeping the gateway the single budget authority.
2. Pace computed in `arbitrationContextFromState` (next to `computeBudgetSignal`, `arbitrator.ts:1467`) and stored on `state.meta` so think/act/finalize read one value per iteration.
3. Policy compiler emits the threshold table + band-action map; strategies never hardcode either (consistent with strategy-to-policy migration order in the ratified 9-pillar plan).
4. Bench gate: rw-suite ≥ no-regression on pass rate; new receipts assert (a) zero `budget_exceeded` exits on runs that reached triage band, (b) generous-class usage only on terminal/final-deliverable calls.

**Cheap pre-Phase-6 wins (independently shippable, bench-gated):** E10 fail-fast (few lines, kills the 3×-identical-retry pathology); E2 finalize/runner synthesis reclass; E5 scratchpad carry across strategy switch.
