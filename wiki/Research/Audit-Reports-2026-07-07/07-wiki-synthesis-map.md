# Architecture Sweep 2026-07-07 — 07-wiki-synthesis-map

I have full coverage across all requested sources. Here is the audit.

---

# Wiki → Adaptive-Harness Overhaul Mapping

Scope note: read the 9-pillar spec, 7-phase plan, ratified decision, A1–A4 + capability-gap synthesis, the 2026-06-30 prompt/context/SO audit, improvement-ledger.json, 02-FAILURE-MODES, 08-North-Star, M1–M13 verdicts, Decision Index. All file paths absolute below.

## Prior findings that STAND (must inform the sweep) — finding → source → overhaul phase

- **12 flat-budget LLM sites + 9 untraced `llm-direct` sites; retries reuse dead budget** (54 dead exchanges, 113,152 wasted tokens, 37.1 min) → `wiki/Research/Harness-Reports/2026-07-07-a2-harness-tax-decomposition.md` F1+F2 → **Phase 1 LLM Gateway**. Named call sites already enumerated (code-action.ts:121/246, tool-execution.ts:854, blueprint.ts:518, plan-execute.ts:446/1063, finalize.ts:150, infer-required-tools.ts:170/299) — the sweep should not re-derive these.
- **`resolveStepReferences` splices compressed-preview blobs into chained tool args → deterministic Tavily 400s** (A3 #3, 8 failures/3 traces; "explains a large share of B3's noisy-search framing") → `2026-07-07-a3-failure-mode-census.md` → already FIXED (FM#3/FM#3b per capability-gap synthesis), but the structural cause (strategy owns arg-resolution) → **Phase 4 Evidence Ledger / Phase 7**.
- **All-analysis plan-execute plan narrates SATISFIED with zero tool calls; F1 grounded-terminal guards only the react loop** (A3 #4, `01KWXXD0…`) → `2026-07-07-a3-failure-mode-census.md` → **Phase 3 Terminal Authority** (extend F1 invariant to plan-execute/blueprint completion).
- **Strategy-switch escalation re-executes completed tool work (~2× run cost); handoff carries text summary, not tool-result state** (A2 F3, `strategy-switch.ts:103-140`) → `2026-07-07-a2-harness-tax-decomposition.md` → **Phase 4 Evidence Ledger** (switch = new policy over same ledger).
- **Loop-detector strategy-switch races and beats F1 abstention → `loop_graceful` not `abstained`; F3 steers to wrong remedy on path-hallucination** (A3 #5/#6) → `2026-07-07-a3-failure-mode-census.md` → **Phase 5 Control Plane** (proposals to one resolver; abstention outranks switch).
- **Kernel value is model-conditional: +11pp weak (cogito:8b), −22pp strong (qwen3:14b) pre-fix; the `supportsThinkingMode` capability flag is the mechanical trigger** → `2026-07-07-a1-manual-react-autopsy.md` (Q5) → **Phase 6 Policy Compiler** (the A1 thesis operationalized; acceptance test = adaptive ≥ max(minimal,full) on BOTH models per task class).
- **"manual-react" is RA's own `.withTools()`-only inline fallback, not a competitor** — so the bench isolates reasoning-layer additions cleanly → `2026-07-07-a1-manual-react-autopsy.md` (Finding 0) → framing for the whole overhaul (Phase 7 hollows strategies onto one loop).
- **Grounding contract ≠ visibility floor** (rw-7/8/9 100%→0 regression when requiredTools incidentally doubled as visibility floor) → `2026-07-07-capability-gap-synthesis.md` (re-run #1 lesson) → **Phase 2 Tool Surface Compiler** (its exit criterion is literally this).
- **Leading-practice adoptions, in leverage order** — universal todo tracker (P6a, SHIPPED opt-in `.withMetaTools({todo:true})`), independent different-model live checker (P6b DESIGN READY, `.withIndependentChecker()`), compaction-outcome self-check, single compaction path, protected-content class → `2026-07-07-a4-leading-harness-practices.md` + `capability-gap-synthesis.md` P6 → **Phase 3 (checker slot), Phase 4/9 (compaction folds in)**.
- **Prompt/context/SO defects already FIXED on branch `fix/prompt-context-so-audit`** (SO-1 json-repair string corruption, CM-1 dropped ungrounded user msgs, SO-2 field-provenance false grounding, PR-1 tool-name collision warn) → `wiki/Research/Audit-Reports-2026-06-30/prompting-context-structured-output-audit.md` → the sweep should treat these as CLOSED, not re-find them.
- **Two-records doctrine (messages[] LLM-visible / steps[] systems-observed) is the ledger's correct seed** → `wiki/Decisions/Decision Index.md` (Dual Record System, ACCEPTED) + `08-AGENTIC-OS-NORTH-STAR.md` §4.1 → **Phase 4** (both become projections; preserve, don't discard).
- **One-event-log keystone + `result.receipt` trust spine + LLM I/O live capture** → `08-AGENTIC-OS-NORTH-STAR.md` Arc 1 → converges with **Phase 4 Evidence Ledger** (the North Star's "one canonical log" IS the RunLedger; receipts become ledger queries, closing P7).

## Prior findings FALSIFIED or superseded (do NOT resurface)

- **The 6+ falsified levers (blacklisted per `01-RESEARCH-DISCIPLINE`)**, per `08-AGENTIC-OS-NORTH-STAR.md` §9 and `2026-07-07-a2-harness-tax-decomposition.md`: **cache-churn, extractObservationFacts-44%, local-step-economy, rationale-splitting/rationale-breaks-weak, escalation-lift, dual-compression** (A2's list substitutes **cogito-17-step-stall** for dual-compression — so 7 distinct falsified items total across the two docs).
- **Heavy-strategy parity FALSIFIED (memory 2026-06-05)** → no new reasoning strategies. `08-AGENTIC-OS-NORTH-STAR.md` §9.
- **LATS / GoT stay dead per spike verdicts** → ideal-arch anti-goals; no new strategy frameworks. `2026-07-07-ideal-harness-architecture.md` line 85.
- **ra-full vs bare-llm on local tiers REJECTED** — improvement-ledger sole entry: 19pp lift but 554.7% token overhead, "a tier significantly regresses" → static full-kernel-everywhere is dead; this is the empirical case FOR the policy compiler. `wiki/Research/Harness-Reports/improvement-ledger.json`.
- **Per-event harness bookkeeping (entropy/snapshots/guards ≈ 12% of clean-run wall-clock) is NOT a tax worth chasing** — A2 Finding 4 (negative), explicitly "don't resurface as a suspect." `2026-07-07-a2-harness-tax-decomposition.md`.
- **Local-tier prompt bloat NOT a live issue** (A1 measured 929-char system prompts; tier-conditioning already works) — trim duplicated Goal block opportunistically only. `2026-07-07-capability-gap-synthesis.md` (Ruled out) + A2 Finding 4.
- **Nuance/contradiction to carry:** the "extractObservationFacts-44% falsified lever" refers to a *perf-experiment result, not dead code* — CM-5 in the 06-30 audit confirms it is actively wired, tier-gated (`act.ts:145 shouldExtract`). Do not delete it as dead code on the strength of the blacklist entry.

## Ablation-verified mechanisms (M1–M13, 2026-05-04 verdicts) — `wiki/Experiments/M*.md`

- **M1 RI Dispatcher — KEEP** (critical intervention capability; feeds Phase 5 control plane).
- **M2 Strategy Switching — KEEP** (complexity handling) — but see Contradictions: later falsification of escalation-lift + A2 F3 cost undercut this; Phase 4/7 rework.
- **M3 Verifier and Retry — IMPROVE** (verifier production-ready; retry context needs tuning — note M3 rework 2026-05-12 disabled the retry loop, kept the heuristic gate).
- **M4 Healing Pipeline — KEEP** (exceptional perf).
- **M5 Context Curation — KEEP** (38.6% token savings, zero regressions).
- **M6 Skill System — IMPROVE** (lifecycle ready; persistence needs implementation).
- **M7 Calibration — IMPROVE** (framework defined; consumers need activation — now the fuel for Phase 6).
- **M8 Sub-agent Delegation — IMPROVE** (harness ready; real-LLM validation pending; A4 rates delegation at-parity/ahead).
- **M9 Termination Oracle — KEEP** (arbitrator pattern; single-owner for react — Phase 3 generalizes it).
- **M10 Memory System — IMPROVE** (core validated; multi-session scenarios).
- **M11 Diagnostic System — KEEP** (production-ready).
- **M12 Provider Adapters — KEEP** (7/7 hooks, 254/254 tests).
- **M13 Guards and Meta-tools — KEEP** (100% accuracy, 0.001ms).
- Tally: **8 KEEP, 5 IMPROVE, 0 REMOVE**. None verdicted REMOVE — the overhaul centralizes, it does not delete mechanisms.

## Gaps: architecture surfaces with NO / thin prior audit coverage

- **Policy Compiler surface itself (Phase 6)** — net-new; A1 motivates it but no prior audit of a capability→config compiler. Capability table + calibration exist (M7) but "capability-conditional composition" has zero implementation-audit coverage.
- **Control Plane merge (Phase 5)** — only n=1 evidence each for the race (A3 #6) and wrong-remedy steering (A3 #7). The "two half-control-planes" claim (ideal-arch pillar 8) is asserted from structure, not trace-audited at scale.
- **Memory subsystem diagnosis (P7)** — A3 #9: memory emits ZERO trace events; rw-8 memory-fidelity failures are un-root-causable. Evidence-ledger's memory projection has no observability substrate yet.
- **Tool Surface Compiler scatter (Phase 2)** — only PARTIAL coverage (PR-2 in 06-30 audit flags the unbounded `computePromptSchemas` union; the rw-7/8/9 regression is one data point). No consolidated audit of all 4 scatter sites (tool-schemas.ts, computePromptSchemas, buildToolSchemas, guard checks).
- **Blueprint / reflexion / ToT strategies** — the 2026-07-07 trace corpus is react + plan-execute only. Blueprint's own terminal path and reflexion/ToT finishes have no failure-census coverage though Phase 3/7 must touch them.
- **Compaction-inflated-output event** — A4 identifies the missing Gemini-style `CompressionStatus` self-check as theoretical; no live trace of a compaction pass actually growing context has been captured.
- **Stale FM taxonomy** — `02-FAILURE-MODES.md` (seeded 2026-04-27) is explicitly flagged stale by A3; several statuses (FM-C1 unmitigated shallow-reasoning = rw-2 red-herring gap, still open) are unreconciled with the 2026-07-07 findings.

## Constraints the overhaul must honor

- **Lift rule (binding, default-on gate):** ≥2 tiers, ≥3pp lift, ≤15% token overhead; **ablation-warden veto stands**. `08-North-Star` §9 + overhaul plan execution rules + ratified decision.
- **No big-bang rewrite; strategies hollow out incrementally; every phase ships behind existing API; withers stay unchanged until Phase 6 turns flags into plan-overrides.** Overhaul plan + ratified decision.
- **Anti-goals:** no new strategy frameworks (LATS/GoT dead), no new reasoning strategies (heavy-strategy falsified), no default-on without the lift gate, no learned/self-evolving topologies or tool synthesis (deferred until Arc 2 sandbox). `2026-07-07-ideal-harness-architecture.md` line 85 + `08-North-Star` §9.
- **Phase 6 acceptance test (hard bar):** `ra-adaptive ≥ max(ra-minimal, ra-full)` on BOTH qwen3:14b (strong-thinking) AND cogito:8b (weak) per task class — the A1 thesis inverted.
- **Phase 2 exit invariant:** deleting any single input (e.g. requiredTools) cannot silently change visibility of an explicitly-requested tool ("grounding contract ≠ visibility floor").
- **Single-owner terminate invariant — binding** (`08-North-Star` §10); Phase 3 must generalize it to all strategies, not weaken it. Rule-4 judge separation (judge ≠ any checker model in cells) also binding.
- **Four acceptance adjectives (ratified):** smart / adaptive / efficient / accountable — `wiki/Decisions/2026-07-07-adaptive-harness-architecture-ratified.md`.
- **Receipt = graded evidence, NOT a truth certificate** (Ed25519 certifies provenance, not correctness); two-records doctrine preserved. `08-North-Star` §4.3.
- **Publication (launch-gate item 5) does NOT wait for the overhaul** — ships after re-run #2 verdict. Overhaul plan line 93.
- **Sequencing (dependency-driven):** Phases 1 & 2 parallel/independent; 3 needs 1; 4 needs 3 and unblocks 5; 6 needs 2+3+4; 7 strictly last.

## Contradictions between existing docs

1. **Decision Index is badly stale.** `wiki/Decisions/Decision Index.md` (last updated 2026-05-12) still names **North Star v3.0 as "ultimate design arbiter,"** lists Phase 1.5 as active, and makes **no mention of the adaptive-harness direction** ratified 2026-07-07 or the North Star v6.0 (spec 08, 2026-07-05). The `2026-07-07-adaptive-harness-architecture-ratified.md` decision is absent from the index. Anyone navigating by the index will get the wrong authority hierarchy.
2. **"Single-owner terminate" claimed as a load-bearing live asset, but only true for the react kernel.** `08-North-Star` §2/§10 lists single-owner terminate as verified-live and binding; A1 (Q3), A3 (#4), and ideal-arch pillar 5 show plan-execute/blueprint accept via their own paths (P3). The invariant is aspirational across strategies, not yet architectural — Phase 3 exists precisely to close this gap.
3. **M2 Strategy Switching = KEEP (2026-05-04) vs later falsification.** `wiki/Experiments/M2` verdicts KEEP, but **escalation-lift is on the falsified-levers blacklist**, A2 Finding 3 shows the switch re-executes tool work at ~2× cost, and `02-FAILURE-MODES` FM-D2 still asks "Is strategy switching net-positive or net-negative? Needs ablation spike." The KEEP verdict predates and conflicts with this evidence.
4. **extractObservationFacts: "falsified lever" vs "actively wired."** A2 lists `extractObservationFacts-44%` among falsified levers and `08-North-Star` §9 blacklists "extractObservationFacts"; the 06-30 audit CM-5 explicitly rebuts this — "NOT dead… the 44% lever falsified memory note was a perf-experiment result, not dead code." A sweep acting on the blacklist alone would wrongly delete live, tier-gated code.
5. **FM taxonomy staleness.** `02-FAILURE-MODES.md` (2026-04-27 seed) and `08-North-Star` / A3 (2026-07-07) disagree on mitigation status of several modes (e.g. FM-D1 premature-termination "MITIGATED" vs the B1/P3 fix waves showing it was still stonewalling solved-but-dead runs). A3 supersedes and should be treated as the current census.