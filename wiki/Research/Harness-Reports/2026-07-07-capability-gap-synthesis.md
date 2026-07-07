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
| FM#3 | `from_step` refs spliced preview blobs into chained tool args → deterministic Tavily 400s (real driver of rw-1 "noisy search") | **FIXED + live-verified** (see wave 2) |

## Fix wave 2 (same day, driven by single-cell verifies)

The first rw-1 verify (trace `01KWYBZQ1VZWQEPXCHK94DS8QM`) showed the FM#3 fix incomplete: the model templated `{{from_step:s1:summary}}` — and the `:summary` projection still spliced a RAW 500-char slice (banner intact, over Tavily's 400 cap). Second wave, all committed to local main:

| Fix | What | Evidence |
|---|---|---|
| FM#3b | `:summary` now distills before its 500 slice; web-search clamps >400-char queries at a word boundary instead of failing the provider chain; plan prompt forbids templating results into queries | rw-1 rerun: **9/9 web-searches succeeded**, zero Tavily 400s, all-real entities |
| P1 | Thinking-aware `num_predict` widening at the Ollama choke point (`widenNumPredictForThinking`, +6000 when think on OR default-thinking model) — fixes all 12 flat-budget call sites in one place, incl. the structured-output format path | rw-2: 420s timeout-death → 207s (B1/B2) → **63s pass** — escalation double-pay gone |
| Judge | Criterion-decomposition + partial-credit protocol (live judge had returned accuracy 0 with evidence "All databases mentioned exist") | probe: 2-of-3-satisfied → 0.667 with per-requirement layers |
| Reqs | plan-execute reflect + synthesis now decompose the goal into explicit requirements (rw-1 dropped "identify conflicts" while declaring SATISFIED) | committed; verifies on next cell |
| P2 | traceContext threaded at 9 sites (enforceQualityGate + extractObservationFacts + plan-execute/blueprint/reflexion synthesis) | closes the 36.5s/run llm-direct blind spot |

**Verified cell movement (single-cell, runs=1, judge post-protocol-change — trace-level facts are judge-independent):**
- rw-1 ra-full: 0% (fabricated EdgeVec/LiveBlocks, 3/3 Tavily 400s) → **67%** (parity with bare-llm's 67%; real grounded chain, ObjectBox/Chroma/Qdrant all verified real by judge)
- rw-2 ra-full: error/420s/empty → **pass/63s**; accuracy 0.2 residual is an analysis-quality gap (model blames the red-herring discount instead of the ELEC-4K-TV-001 stock-out) — next-class target, not a harness death

Caveat: the rw-1 0→67 delta bundles harness fixes + judge partial credit; the judge change applies to ALL variants equally in future sessions, so cross-variant comparisons stay fair, but pre/post absolute scores are not directly comparable. The full-session re-run + `rax eval gate` remains the authoritative verdict.

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

## Fix wave 3 (same day — capability rails, user mandate: controllable/auditable/flexible/efficient/powerful)

| Item | Status |
|---|---|
| P6a universal todo checklist meta-tool | **SHIPPED opt-in** (`.withMetaTools({todo:true})`) — pure core + inline handler + scratchpad persistence (checkpoint-safe, run-scoped); default-on pends the cross-tier lift gate |
| P6b live independent checker | **DESIGN READY** (below) — implement after the full-session re-run verdict |

### P6b design — live independent checker

Goal: independent different-model review of the final answer BEFORE it ships (Claude-Code-advisor / Devin-verify pattern). RA's judge-server proves the value offline; this puts the same idea on the live path, opt-in.

- **API**: `.withIndependentChecker({ provider, model, maxRedirects = 1 })` — builder constructs a SECOND provider stack (same `createLLMProviderLayer` machinery as judge-server's live layer) and threads a plain async callback `check(task, answer, evidenceDigest) → { approved, critique }` into kernel input (callback, not Layer — avoids dual-LLMService context plumbing).
- **Integration point**: terminal acceptance, immediately after the F1 grounded-terminal arm accepts — same seam the verifier gates. On `!approved`: one redirect with the critique injected as harness guidance (reuse the B1 redirect mechanics); on repeat failure: ship WITH the checker verdict recorded — never silently, never a loop.
- **Auditability**: new trace event `checker-verdict {approved, critique, model, durationMs}`; receipt gains `checkerVerdict` field (graded evidence, mirrors receipt copy discipline: not a truth certificate).
- **Cost control**: single call per run terminal (plus ≤1 redirect), only when configured; capability-conditional default later (strong SUT → checker optional; weak SUT → recommended) once ablated.
- **Verification**: bench ablation ra-full vs ra-full+checker on cogito:8b + qwen3:14b; gate lift rule decides default posture. Judge (gpt-4o-mini) stays Rule-4-separate from any checker model used in cells.

### Remaining from user mandate mapping
- controllable: killswitches/HITL exist; checker adds output-quality control point.
- auditable: P7 (memory trace events, honesty labels in traces) still open — next after checker.
- efficient: varied retries (retry with temperature bump / reword instead of byte-identical) — small, high-value, unowned.
- flexible/powerful: capability-conditional scaffolding (the A1 through-line) is the strategic arc after the re-run gate verdict.

## Full-session re-run #1 (post wave-2) — INVALID for gate, productive for bugs

90 cells completed clean (zero timeouts — hard-kill works; max cell 344s). But the ra-full column was contaminated on 3/5 tasks by a **regression from the minimal-grounding fix**: kernel lazy tool disclosure (visible = required + relevant + used + meta) lost file-write when requiredTools narrowed to ["file-read"] and the weak-tier classifier returned nothing — the model literally could not write prices.md (rw-9 100%→0, 3/3 honest-failures), test files (rw-7 all-variants-0 for RA's part), or the rw-8 pipeline files. The old over-wide requiredTools floor had been *incidentally* providing visibility.

**Fix (committed):** explicit `withTools({builtins:[...]})` = consumer intent → unioned into kernel `relevantTools` (lazy-disclosure floor) + adaptive-filter floor. Live verify: rw-9 0%/empty → **1.0/59s**.

Legit findings from the same run:
- rw-1 ra-full 66% vs bare 66% at session scale — research-task parity CONFIRMED with runs=3 (was −67).
- rw-2 ra-full 20% vs bare 33% — red-herring analysis gap persists (open, model-reasoning class).
- Competitor rw-1 zeros are legit refusals ("cannot perform live research… only file operations" — their by-design file-only toolset), judged 0 under partial credit.
- rw-8 competitor 100s legit: their file tools write directly to tmpDir; deterministic verify passes.
- Bench integrity: zombie contention gone; durations trustworthy.

Lesson for the ledger: **grounding contract ≠ visibility floor.** requiredTools narrows what the terminal gate demands; it must never be the only thing keeping a tool visible. (Ideal-architecture pillar 6 — composition should be explicit, not incidental.)

Gate verdict deferred to re-run #2 (post visibility fix + P3/P4 + todo).
