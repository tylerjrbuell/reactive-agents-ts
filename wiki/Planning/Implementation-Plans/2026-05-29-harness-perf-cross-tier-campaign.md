---
title: Harness Performance + Cross-Tier Consistency Campaign
date: 2026-05-29
status: active
branch: main (post canonical-refactor merge d783c876)
related:
  - "[[2026-05-29-e2e-perf-bottleneck-findings]]"
  - "[[improvement-2026-05-29]]"
  - "[[project_canonical_refactor_2026_05_28]]"
---

# Harness Performance + Cross-Tier Consistency Campaign

## Objective (user-stated)

Close the agentic-performance gap so the harness delivers **consistent, proven
results across all model tiers** (frontier / mid / local). Two axes, both
first-class:

1. **Context engineering** — agents must get tool results **in-context for
   synthesis without an explicit `recall()` round-trip**. (User: "this is a
   huge part of the performance, not just wall-clock.")
2. **Loop economics** — eliminate wasted iterations (late stall detection),
   context bloat (full-history re-send), and blocking memory-flush scaling.

Every change ships with **empirical cross-tier before/after** proving lift.

## Redesign mandate (user-stated 2026-05-29)

**Do not shy away from redesigning harness systems that reduce agentic
performance.** The Fix phase is NOT constrained to parameter tuning or a single
minimal edit. Where the *design itself* falls short, build a better one — a
subsystem redesign is in-scope. Constraint unchanged: **earn the redesign from
trace evidence** (locate exactly where the design fails), then build the
canonical solution, then **prove it's better** with cross-tier before/after.

**Design contradiction already identified (lead redesign target):** the harness
compresses tool results OUT of context, then exposes `recall()` as a manual
escape hatch — directly contradicting the framework's own stated philosophy
(`task-quality-gate.ts:14-17`): *"Recall is automatic + contextual, not 'agent
must call recall()'. The harness's job is to ensure all relevant memories are
IN-CONTEXT and available for synthesis."* The redesign question is not "what's
the right `optimalToolResultChars`" but **"what's the right observation/context
assembly architecture so synthesis-relevant data is in-context by design,
making manual recall unnecessary."**

## Method discipline (advisor-locked)

- **Earn the root cause from the REAL task's traces.** Do not import the
  compression hypothesis from the synthetic T1–T5 probe and go find a task to
  fit it. Baseline the real workload first; let its traces drive diagnosis.
- **Lead with low-variance structural metrics**, composite quality secondary.
  Structural metrics are near-deterministic integers → lift is falsifiable
  cheaply. Composite is noisy → needs many runs to move 3pp credibly.
- **Variance plan before lift claims.** N=1 cannot detect the project's
  ≥3pp / ≤15%-token ablation gate against LLM stochasticity.
- **Discovery vs proof split.** Real MCP task (docker+network+GitHub API) =
  high-variance discovery substrate. Deterministic custom-tool task = low-variance
  proof substrate. Prove fixes on the latter; confirm on the former.

## Substrate

### Tasks (decision: GitHub-MCP + custom-tool)
| Role | Task | Script | Variance | Purpose |
|---|---|---|---|---|
| **Discovery** | GitHub MCP: fetch 10 commits → categorize → write markdown → self-critique | `apps/examples/spot-test.ts` task (pinned into a probe, NOT the live-edited file) + `mcp-comprehension-probe.ts` | High (docker/net/API) | Surface real failure modes; confirm hypotheses cross-tier |
| **Proof** | HN custom-tool T1–T5 (deterministic cached data; already captures `callsRecall` smell + structural metrics) | `.claude/skills/harness-improvement-loop/scripts/task-quality-gate.ts` | Low (cached HN data) | Measure variance; prove fix lift with tight before/after |

The HN gate is already a custom-tool multi-step substrate with pinned data —
reuse, don't rebuild. T3 (top-3-by-comments from 25-item fetch) is the task
that exercises the lead hypothesis.

### Tier matrix (all 5 verified available 2026-05-29)
| Tier | Model | Provider | Key/Source |
|---|---|---|---|
| Frontier | claude-sonnet-4-6 | anthropic | ANTHROPIC_API_KEY ✓ |
| Mid | gemini-2.5-flash | gemini | GOOGLE_API_KEY ✓ |
| Mid | gpt-4o-mini | openai | OPENAI_API_KEY ✓ |
| Local | qwen3.5:latest | ollama | local ✓ |
| Local | cogito:14b | ollama | local ✓ |

## Metric ladder (structural primary)

| Metric | Source | Variance | Role |
|---|---|---|---|
| `llmCalls` | `state.llmCalls` / trace `kernel-state-snapshot` | near-det | **PRIMARY** — recall round-trip = "3 vs 2" |
| toolCallCount | `result.metadata.toolCalls` | near-det | PRIMARY — counts `recall()` smell |
| input tokens | trace / metadata | low | PRIMARY — context-bloat axis |
| iterations-to-terminate | trace snapshots | near-det | PRIMARY — stall axis |
| wall ms | probe timer | medium | secondary (machine-dependent) |
| total tokens | run-completed | medium | secondary |
| composite quality | gate scorer | HIGH | secondary — correctness guardrail only |
| `callsRecall` bool | gate scorer | near-det | PRIMARY context-eng signal |

**Lift gate (project ablation rule):** ≥3pp first-attempt lift AND ≤15% token
overhead → default-on; else opt-in; else remove.

## Variance protocol (decision: N=3 → set from spread)

1. Baseline each tier×task cell **N=3**.
2. Measure spread on PRIMARY structural metrics.
3. If structural metrics are stable (expected — they're integers) → N=3 suffices
   for structural lift claims. Composite claims → raise N until 3pp is outside
   the noise band. State the variance budget per metric before any lift claim.
4. Replay fixtures: **deferred** until probe variance becomes the proof
   bottleneck (skill's deferred capability).

## Hypothesis ledger (confirm from real-task traces — do NOT pre-commit)

- **H1 (LEAD) — compression-unifies.** Tool-result/observation compression
  budget is neither tier-aware nor task-shape-aware. Conservative preview
  default (5 items) drops data frontier tasks need → forced `recall()`
  round-trip (+1 llmCall), AND feeds local stall loops. ONE canonical fix
  (task-shape-aware + tier-aware render budget) lifts both tiers.
  - *Falsifier:* if frontier recall and local stalls have independent causes
    in the traces, H1 is wrong → two levers, not one coordinated change.
- **H2 — no frontier calibration profile.** Frontier models hit the
  local-tuned conservative default because they have no profile
  (`optimalToolResultChars`). Sub-hypothesis of H1's tier-aware half.
- **H3 — late stall detection (B1).** Stall→deliverable handoff waits ~8
  identical-signature iterations; loop-detector streak rule exists but isn't
  wired to short-circuit. Local-tier dominant.
- **H4 — memory-flush O(conversation) blocking (B3).** Complex runs run
  extraction blocking over full history (5.3s on 20-step). Independent lever.

## Sequence

1. ✅ Orient (prior reports + infra verify) — DONE 2026-05-29.
2. **Baseline** — N=3 structural-metric baseline. Start cheap/fast
   (gpt-4o-mini) to validate the metric-extraction pipeline + measure variance,
   then gemini, sonnet, qwen3.5, cogito:14b. GitHub-MCP discovery: 1 run/tier.
3. **Diagnose** — `rax:diagnose replay/grep/diff` on real-task traces.
   Confirm or refute H1 (compression-unifies) cross-tier.
4. **Fix / Redesign** — right-sized canonical solution per confirmed root
   cause. May be a subsystem redesign (per redesign mandate), not just a
   parameter. If the diagnosis points at a design contradiction (e.g.
   compress-then-recall), write a short design spec to
   `wiki/Architecture/Design-Specs/` BEFORE coding, then build. Rebuild
   affected packages.
5. **Verify** — cross-tier before/after on primary structural metrics;
   `rax:diagnose diff`; `bun test` no net-new regressions; lift gate.
6. **Commit + debrief** — evidence in message; `claude-obsidian:save` debrief;
   update this plan's status.

## Diagnosis D1 — recall is REDUNDANT (reframes H1; contradicts prior report)

**Evidence:** gpt-4o-mini N=3 on the proof gate + trace replay
(`01KSV146F4…` recall, `01KSV15YXH…` no-recall).

1. **Recall trigger is stochastic; cost is deterministic.** T3 recall 1/3 runs,
   T4 recall 2/3. When it fires: toolCalls 2→3, iterations 6→9 steps,
   tokens ~5.8K→~11.7K (2×), +1 wasted iteration. Same task/model/data →
   coin-flip. (∴ `callsRecall` is NOT near-deterministic — plan metric ladder
   corrected; recall **rate** needs high N or tail-elimination framing.)
2. **Full tool data already reaches synthesis WITHOUT recall — recall is
   redundant.** T2 (15-item fetch), no recall, all 3 runs cited **15/15 titles +
   15/15 scores**. T3 (25-item, sort-by-comments needs all 25), no-recall runs
   got **3/3 correct titles + 3/3 correct comment counts, no confusion** —
   identical to the recall run. Recall changed nothing.
3. **Mechanism (two-record architecture):** `state.messages` carries the full
   tool_result to the LLM (∴ synthesizable); `state.steps` renders a compressed
   `Preview (first 5 of N)` + **"Use recall() to retrieve the rest"** lure. The
   lure text stochastically induces a redundant round-trip for zero correctness
   gain. **This is the design shortfall, NOT "data dropped from context."**
4. **Secondary design issue — entropy non-discriminating.** Entropy flat at 0.15
   the entire run → stall-detect fires false "model appears stuck" then
   self-suppresses (below-entropy-threshold) on a normal successful run.
   Entropy can't distinguish working-from-stuck. (Separate lever; not D1.)
5. **trace `llmCalls`=0 (emit not wired)** → use toolCall count as the clean
   llm-round-trip proxy.

**A-vs-B resolved by source locator (advisor-required):** mechanism is **A below
a threshold, B above it**.
- `conversation-assembly.ts:98-119` (Sprint 3.4 "G-4 closure") writes the FULL
  scratchpad content into `state.messages` (the LLM thread), capped at
  `TOOL_RESULT_INLINE_CAP = 4000` chars. ≤4000 → full data inline, NO lure →
  **recall redundant (mechanism A).** HN gate data is ≤4000 → D1 holds; T2's
  15/15-no-recall explained.
- >4000 → inline truncated + "Full available via recall(...)" →
  **recall genuinely needed (mechanism B).** GitHub-MCP / large CLI output
  likely crosses this.
- The `tool-execution.ts:705-716` lure strip + re-append is on the observation
  content; conversation-assembly OVERRIDES it with full data for the thread.

**Actual lure source (not the conversation thread):** `context-engine.ts:189-205`
adds a standing system-prompt rule — *"Large tool results are stored
automatically. Use recall(key) to retrieve full content when needed"* — whenever
`hasStoredResults`. On all tiers. With full data ALSO inline (≤4000), the model
can't tell "inline, recall unneeded" from "truncated, recall needed" → coin-flip.
**`hasStoredResults` conflates "stored" (always on compression) with
"truncated-from-conversation" (only >4000).**

**Fix candidate (mechanism-A-safe, NOT committed — pending local baseline):**
gate the recall advertisement on *actually-truncated-inline* (>4000 cap), not on
`hasStoredResults`. Full data inline → no recall rule → no redundant recall;
truncated → explicit deterministic recall instruction. Prove: recall rate → 0 on
≤4000 results, token p95 → no-recall baseline, composite unchanged, AND >4000
results still recall correctly (no silent degradation).

**Advisor cross-tier caution (open):** D1 is gpt-4o-mini only. Prior findings say
local tier's dominant failure is loop-economics (B1/B2/B3 stalls), not this lure.
D1 may have SPLIT the unification hypothesis: mid/frontier = redundant-lure;
local = loop economics (the entropy/stall observation, item 4 above, is likely
the PRIMARY local lever). qwen3.5 + cogito:14b baseline gates the redesign-scope
decision — do NOT conflate two tier-specific problems under "one canonical fix."

## Diagnosis D2 — research UNIFIES the two levers under one canonical model

See [[2026-05-29-agentic-context-engineering-findings]] (Anthropic context-eng,
MemGPT/Letta, Arize, JetBrains). The field converges on a 3-rule model:
1. **recent observations inline-full** (we do this, ≤4000 — ✅)
2. **old observations cleared/compacted** (Anthropic "tool result clearing" +
   MemGPT "observation masking") — we DON'T (full-history re-send → local
   token-bloat: qwen3.5 T2 no-recall 12K vs gpt-4o-mini 5.8K, 2×) — ❌
3. **recall only for data NOT in context** (just-in-time) — we mis-apply
   (`hasStoredResults` advertises recall for inline data → D1) — ❌

**So D1 (frontier redundant-recall) and local token-bloat are NOT two unrelated
problems — they are rules 3 and 2 of ONE canonical context model the harness
half-implements.** Redesign target = **"recent inline-full · old cleared ·
recall only for absent data."** One coherent design, addresses both tiers.
Entropy stall-detect → replace with structural "boredom detection"
(same-tool+params repetition), per research (separate, secondary).

Local-baseline data (qwen3.5 run 1): recall lure DOES reproduce on local
(T4 recall 1/5) AND independent token-bloat present (T2 no-recall 2× tokens) —
consistent with BOTH rule-2 and rule-3 defects on local. Full N=3 + cogito
pending before locking redesign scope.

## Diagnosis D3 — cross-tier baseline: THREE distinct failure modes (N=3)

Proof-gate (T1–T5) N=3 per model. Recall = task-runs firing recall / 15.

| Model | Tier | Recall | Tokens (T2 15-item) | Composite | Dominant failure |
|---|---|---|---|---|---|
| gpt-4o-mini | mid | 3/15 stochastic | ~5.8K | ~95% stable | **redundant recall** (data was inline) |
| qwen3.5 | local | 3/15 stochastic | **~12K (2×)** | ~94% (T5 71%) | **token bloat** + recall |
| cogito:14b | local | **0/15** | 6–10K variable | **low+variable** (T3 82/34/88, T5 65/55/81) | **degraded context use → wrong answer** |

(gemini-2.5-flash + claude-sonnet-4-6 N=3 running — frontier/mid completion.)

**Key insight:** a flat recall-fix helps gpt-4o-mini/qwen3.5 but does NOTHING for
cogito (it never recalls — it just fails). cogito's T3=34% is silent degradation:
answered a sort-25-by-field task from degraded context without recalling. → The
**tier-calibration axis is load-bearing**, not cosmetic. Confirms the advisor's
"don't conflate tiers" caution AND the research's effective-context/context-rot
findings: weak models need TAILORED (terse, recency-placed, small) context to use
it correctly. This is the user's exact ask, now evidence-backed.

## Decision — spec scope (2026-05-29)
ONE coherent design spec (3-rule context model × tier-calibration axis); BUILT +
PROVEN as separate ablatable increments, each with its tier-appropriate metric:
1. Rule 3 recall-gating → recall-rate→0 (gpt-4o-mini/qwen3.5), no >4000 regression.
2. Rule 2 old-obs clearing → tokens↓ (qwen3.5), composite flat.
3. Tier-calibration → cogito T3 variance↓ + composite↑ (highest value).
Each vs ablation gate (≥3pp / ≤15% tokens). Spec → `wiki/Architecture/Design-Specs/`.

## Cross-tier token spread (full matrix, T2 same task)
sonnet 2.2K · gpt-4o-mini 5.8K · qwen3.5 12.2K — 6× spread, input hard-capped
4000 all tiers → spread is OUTPUT verbosity, not input. (sonnet/gemini recall on
T3 stochastically, matching frontier report; frontier composite 99% stable.)

## Instrumentation — input/output token split (DONE 2026-05-29)
Surfaced `metadata.inputTokens`/`outputTokens` in the probe. Production path was
ALREADY wired (`step-utils.ts:90-92` reasoning metadata → `execution-engine.ts:
1116-1117` AgentResult metadata); `snapshot-final.ts` hardcoded-0 is a separate
fallback. No production change — probe-only.

**Finding (refutes BOTH bloat hypotheses): tokens are INPUT-dominated.**
gpt-4o-mini T2 in:4796/out:351, T3 in:5180/out:113, T4(recall) in:9902/out:1297,
T5 in:4869/out:706. In:out ≈ 10–45:1. So local bloat is NOT output verbosity
(Inc-2-revised was wrong) NOR was the 20-step "93% input" stalled-run finding
the mechanism here. Recall cost is mostly INPUT re-send (T4 +~5K input). Inc 2
root cause = WHICH input (tool-result payload / curator injection / re-fed
reasoning). qwen3.5 split (running) localizes it.

## Status log
- 2026-05-29: Plan created. Infra verified (5 models, keys, docker, traces).
  Hypothesis ledger seeded from prior-session findings.
- 2026-05-29: gpt-4o-mini N=3 baseline done. **D1: recall is redundant** (see
  above) — reframes H1, contradicts prior frontier report's "data dropped"
  mechanism. Advisor consult next before redesign. Then extend baseline to
  gemini/sonnet/qwen3.5/cogito + GitHub-MCP discovery; ground in agentic
  research (autoresearch loaded).
