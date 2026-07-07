# Harness capability-gap synthesis — 2026-07-07

**Inputs:** bottleneck determination (B1–B5) + four parallel analyses: [[2026-07-07-a1-manual-react-autopsy|A1 minimal-vs-kernel autopsy]], [[2026-07-07-a2-harness-tax-decomposition|A2 token/latency tax]], [[2026-07-07-a3-failure-mode-census|A3 failure-mode census (59 traces)]], [[2026-07-07-a4-leading-harness-practices|A4 leading-harness practices]]. Mandate: make the RA harness as capable as the leading agentic harnesses, on evidence.

## The reframe (A1)

The bench's winning "manual-react" variant is **RA's own minimal loop** (`.withTools()`-only, same engine, no kernel). So the qwen3:14b result is not "a competitor beats RA" — it is **RA-minimal beating RA-kernel on a strong thinking model**, while RA-kernel beats RA-minimal by +11pp on a weak model (cogito). The kernel's job is to never subtract: its additions must be tier/model-conditional, and its failure modes (below) are what turn its execution-task wins into research-task losses.

## Status of the fix wave (this session)

| ID | Failure mode | Status |
|---|---|---|
| B1 | Unmet-required end_turn stonewalled (solved-but-dead runs) | **FIXED + live-verified** (rw-2: error/420s/empty → pass/207s/grounded answer) |
| B2 | Thinking-token starvation in the react think loop | **FIXED** (capability-driven `thinkingModel` + widened budget) — extension needed, see P1 |
| B3 | Fabrication under forced grounding | Partial (evidence-rule prompt) — root cause was largely FM#3 |
| B4 | Trace stopReason lied on truncation | **FIXED** |
| B5 | Bench zombie fibers / timeout contamination | **FIXED** (AbortSignal hard-kill) + `--variant` + weakness-queue + judge/`--output` discipline |
| FM#3 | `from_step` refs spliced preview blobs into chained tool args → deterministic Tavily 400s (real driver of rw-1 "noisy search") | **FIXED** (distilled bare refs, analysis pass-through, `:full` opt-in) — live verify in flight |

## Open gaps, ranked (evidence-weighted)

**P1 — Thinking-aware budgets everywhere LLM calls happen (A2 #2, A3 #4-adjacent).** 8 structured-output/planning call sites use flat `maxTokens: 4096/2048` with no thinking awareness and no Stage-1 escalation; retries reuse the same dead budget. Measured: 54 dead exchanges, **113,152 wasted output tokens, 37.1 min of pure waste** corpus-wide; one run burned 91% of its wall-clock on 3 byte-identical failures. The B2 fix pattern (profile.thinkingModel) is shipped — this is its rollout to `code-action.ts`, `blueprint.ts`, `plan-execute.ts:446/1063`, `finalize.ts`, `infer-required-tools.ts`, `tool-execution.ts`, + escalation in the planning sub-kernel.

**P2 — traceContext threading at 9 LLM call sites (A2 #1).** 70.6% of runs have real LLM calls filed under the `llm-direct` placeholder — median 36.5s of run time invisible per run. Every future diagnosis pays this blind spot. Mechanical fix: thread `traceContext` like think.ts does.

**P3 — Grounded-terminal for plan-execute (A3 #4).** An all-analysis plan (7 steps, zero tool calls) narrates "SATISFIED" and ships `status: success` — the F1 invariant only guards the react loop. Plan-execute needs the same gate at its reflect/synthesize acceptance (requiredTools ∧ zero substantive calls → redirect once → honest abstention).

**P4 — Strategy-switch state carryover (A2 #3).** Escalation re-executes already-completed tool calls (observed ~2× run cost). Carry the tool-result ledger across the switch.

**P5 — Arbitration precedence + steering quality (A3 #6, #7).** Loop-detector strategy-switch races and beats F1's honest abstention (`loop_graceful` instead of `abstained`); F3's recovery nudge steers to the wrong remedy on file-path hallucination ("call file-write" when the fix is "call find first"). Both are precision fixes in existing mechanisms.

**P6 — Leading-practice adoptions (A4).** In leverage order: (a) universal todo/plan tracker as a callable tool + result surface (Claude-Code-style; RA's Plan type is locked inside plan-execute); (b) independent different-model checker in the LIVE loop (judge-server exists, only feeds offline eval — wire as opt-in verify layer); (c) compaction-outcome self-check (detect when compaction grew context); (d) consolidate the two uncoordinated compaction paths behind one prepareStep-style hook; (e) protected-content class during compaction.

**P7 — Diagnosis substrate gaps (A3 #9).** Memory subsystem emits zero trace events (rw-8/rw-1 memory-fidelity failures un-root-causable); honesty labels live only in report JSON, not traces.

**Ruled out (A2 #4):** kernel bookkeeping (entropy/snapshots/guards ≈ 12% of a clean run's wall-clock) — not a tax worth chasing. Local-tier prompt bloat: not observed as a live issue (A1 measured 929-char system prompts — trim the duplicated Goal block opportunistically, not as a priority).

## Positioning consequence

The kernel's value is real but conditional: **+11pp on weak models, −22pp on strong thinking models (pre-fix)**. The through-line for P1–P6 is *adaptivity* — budgets, gates, and scaffolding that read the capability table instead of assuming one model class. RA already owns the best substrate for this (per-model calibration + capability table + receipts); the leading-harness gap is mostly conditional application of machinery RA already has.

## Verification protocol

Each P-fix: single-cell verify via weakness-queue probe command (minutes, post-amplification) → full-session re-run + `rax eval gate` lift verdict + ledger entry before default-on. Publication (launch-gate item 5) stays blocked until the re-run shows the post-fix story.
