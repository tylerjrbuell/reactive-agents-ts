# Full-Potential Realization Plan

> **Date:** 2026-06-03 · **Branch baseline:** `main` @ `aed8a8a2` · **Companion:** [[Framework-Architecture-Index]] · [[2026-06-03-architecture-drift-register]] · [[05-DESIGN-NORTH-STAR]]
>
> **Thesis:** The canonical-contracts + Compose arcs are *merged*, but landed **unevenly**: the *infrastructure + types* shipped, while the *saturation* (making each contract the sole/complete path) is incomplete everywhere — deliverable single-writer unbuilt + two `Deliverable` types coexisting (P1), `TaskContract` bench-only (P2), calibration 5/14 consumers (P3), compose ~4/24 chokepoints emitting (P4). The highest-impact work is **not new features; it is finishing the half-done migrations** so the framework's stated guarantees (anti-black-box, anti-hallucination, trust) become *constructively true* instead of aspirational. Everything below is ranked on: **(North-Star value) ∧ (incomplete-or-absent on `main`)**, verified in code, not spec.

## Ranking summary

> **Progress 2026-06-03** (branch `refactor/arch-cleanup-2026-06-03`): **P1 ✅ COMPLETE — structurally AND behaviorally validated.** Commits b3aef454/0e80b82a/e4abf43e/2bb06cf8: single-writer + 4-source type + guard; 1559/0 reasoning, 68/68 typecheck. **Cross-tier N=3 PASSED** (local qwen3.5 + mid haiku + frontier sonnet): zero regressions, all 9 main-passing cells green, sonnet-summarize improved 0→67%, aggregate 75→81%. Evidence: [[2026-06-03-p1-deliverable-provenance-n3]]. **Mergeable.** Follow-up debt (non-blocking): **S11** (synthesis-gate provenance-tag). **P5 ✅ complete** (1d33f9b9 + a12f37b9). **Next: P2 (TaskContract→runtime), then P3/P4** — P1's gate passed, hot-loop blast radius cleared for stacking.

| P | Title | Lever | Effort | Gate metric |
|---|-------|-------|--------|-------------|
| **P1 ✅** | ~~Wire deliverable provenance (collapse 2 Deliverable types)~~ **DONE** | Trust pillar — *the* headline gap | M (3–5d) | ✅ 0 raw `state.output` writes (guard-locked); all outputs provenance-typed |
| **P2 ✅** | ~~Thread `TaskContract` into runtime `agent.build()`~~ **DONE (build-time)** | Reliability — bench-only contract → real enforcement | M (3–5d) | ✅ `.withContract()` strict-throws on tool/modelFloor violation; 892/0. Execute-time = P2b |
| **P3** | Activate dormant calibration consumers (5→≥8) | Model-adaptive — defined-not-consumed | M (4–6d) | ≥8 fields with documented cross-tier lift |
| **P4** | M14 self-evolution via compose hooks | Reliability — most-positive research module, unbuilt | M (4–6d) | ≥3pp lift on looping gate scenarios |
| **P5** | Doc-drift cleanup + package consolidation (35→~22) | DX/Control — cheap, compounding | S→L | skills/specs match code; net pkg count down |
| **P6** | Verify + close Phase D/E/F empirical gates | Efficiency/Trust — proof, not claims | L | external bench reproducible; local-tier lift proven |

Sequencing: **P1 → P2 unlock the trust spine and gate everything downstream; run P3 ∥ P4 (different files); P5 is opportunistic-anytime; P6 is the v1.0 credibility arc.**

---

## P1 — Complete the deliverable-provenance migration (single writer + collapse two `Deliverable` types)

**Problem (verified — migration in progress, not scaffold):** Two `Deliverable` models coexist *live in the same files*:
- *2-source (older):* `kernel/loop/runner-helpers/deliverable.ts` `assembleDeliverable` → `{ content, source: "model_synthesis"|"raw_artifacts" }`. Used in `runner.ts:65`, `loop-resolution.ts:144,179`, `stall-deliverable.ts:126,224`.
- *4-source (canonical):* `core/contracts/deliverable.ts` `modelSynthesisDeliverable`/`sentinelDeliverable`/`deliverableToContent`. Used in `runner.ts:529,538`, `iterate-pass.ts:351,357`.

`runner.ts` imports **both**. The intended single-writer **`commitDeliverable` was never implemented** — it exists only in that file's `@example` JSDoc (`:20,:27`); there is no `export function commitDeliverable`. So the North Star §6.5 claim "every output through `commitDeliverable()`" is *literally* false. `state.output` currently has **~6 writers** with mixed provenance (`runner.ts:344,463,503,538,717,723` — some typed via `deliverableToContent`, some raw `synthContent`/`state.output ?? ''`). Verify: `grep -rn "output:" packages/reasoning/src/kernel/loop/runner.ts`.

**Goal:** Finish the half-done migration: one 4-source `Deliverable` (core contract) as the sole representation, and one real single-writer function that every `state.output` write goes through.

**Scope:**
1. **Decide source-of-truth** (escalation Q1, Drift Register): keep core's 4-source `Deliverable` as canonical; fold the 2-source `assembleDeliverable` semantics (`raw_artifacts` → `harness_synthesis`/`tool_artifact`) into it.
2. **Implement the single writer** — build the `commitDeliverable(state, d)` the JSDoc promises (or rename to match the existing `transitionState` seam), constructed from a `Deliverable` only.
3. **Route all ~6 `state.output` writers** in `runner.ts` + `iterate-pass.ts` through it; remove raw-string writes (`state.output ?? ''`, bare `synthContent`).
4. **Delete the 2-source path** (`runner-helpers/deliverable.ts` `assembleDeliverable` + its 4 callers migrate). No parallel abstraction left.
5. Add a lint/test asserting **zero** raw `state.output` mutations outside the single writer.

**Validation gate:**
- [ ] `commitDeliverable` (or chosen single-writer) is implemented and is the only thing that sets `state.output`.
- [ ] `assembleDeliverable` deleted; one `Deliverable` type remains.
- [ ] Test: any raw `state.output` mutation fails CI.
- [ ] Cross-tier N=3: no regression on `cs-overflow-*` + comfort tasks.
- [ ] Drift Register S5/S6/D5 closed.

**Why #1:** It is the trust pillar's central mechanism, a §4.4 violation (documented-but-unbuilt API + parallel types), and net a *collapse* (less code), not new surface. Unblocks honest provenance for P2/P6.

---

## P2 — Thread `TaskContract` into runtime `agent.build()`

**Problem (verified):** `core/contracts/task-contract.ts` exists but is referenced only by `benchmarks/*` (verify: `grep -rln TaskContract packages/*/src`). Sprint-1 C1.3 intended it threaded into the runtime build path; `PreFlight` runs at `runtime/src/build-validation.ts` but does not consume a `TaskContract`.

**Goal:** A runtime agent can declare a task contract (required tools, deliverable shape, capability floor); `PreFlight.validate(builder, task)` enforces it at `build()` and hard-fails on capability-source fallback / tool-not-exposed / contract violation — in production, not just bench.

**Scope:**
1. Accept an optional `TaskContract` on the builder (`.withContract()` or via run input).
2. Extend `build-validation.ts` preflight to validate against it (reuse `benchmarks/src/preflight.ts` logic — single source).
3. Surface `Capability.source === "fallback"` loudly (the spec's "fires loudly" requirement).

**Validation gate:**
- [ ] Runtime preflight refuses a contract-violating build (test).
- [ ] `Capability.source` fallback produces a visible warning/error, not silent default.
- [ ] No bench-only divergence: bench and runtime share one preflight path.

---

## P3 — Activate dormant calibration consumers (≥8 fields)

**Problem (`[from-spec]` G-7):** 14 calibration fields defined, ~5 with live consumers. Dormant: `parallelCallCapability`, `interventionResponseRate`, `tokenEfficiency`, `reasoningDepth`, `knownToolAliases` (verify each: `grep -rn "<field>" packages/*/src | grep -v calibrations/`).

**Goal:** ≥8 fields with a live consumer + documented cross-tier lift (North Star Phase E Track 2).

**Scope (each gated independently by the lift rule, ≥3pp ∧ ≤15% overhead):**
- `parallelCallCapability` → gate batch tool calls.
- `interventionResponseRate` → gate dispatcher firing on non-compliant models.
- `knownToolAliases` → proactive prompt-injection layer.
- `tokenEfficiency` → cost-router model selection.
- `reasoningDepth` → strategy selector.

**Validation gate:** ≥8 active consumers; evidence artifacts in `wiki/Research/Harness-Reports/`; no field shipped that fails the lift rule (else opt-in or removed — no dead consumers added).

---

## P4 — M14 self-evolution via compose hooks

**Problem (`[from-spec]` §2.2 M14):** Acceptance-gated attempt-narrowing is the most consistently positive research module (+4.8pp SWE / +2.7pp OSWorld, arXiv:2603.25723); **not implemented on main**.

**Goal:** `composeNarrowRetry(maxBroadenAfter)` helper built on compose chokepoints `lifecycle.failure` + `control.strategy-evaluated`. **Prereq:** the compose *infra* landed (HarnessPipeline, `.compose()`, killswitches) but chokepoint coverage is ~4/24 — `lifecycle.failure` **does** emit (`act.ts`), but `control.strategy-evaluated` **does not emit yet**. So M14 includes expanding coverage, not just consuming it.

**Scope:**
1. **Add the missing emit:** fire `control.strategy-evaluated` from `kernel/capabilities/reflect/strategy-evaluator.ts` (payload: `{ currentStrategy, score, failureStreak, recommendedAction, availableStrategies }`).
2. Implement `composeNarrowRetry` consuming `lifecycle.failure` + `control.strategy-evaluated`.
3. Validate on 3 gate scenarios where agents currently loop.

**Validation gate:** `control.strategy-evaluated` appears in traces; ≥3pp lift on looping gate scenarios; **no regression** on non-looping; evidence in `wiki/Research/Harness-Reports/phase-1.5-m14-2026-MM-DD.md`. Subject to ablation-warden default-on rule.

> Doubles as the first installment of closing the compose ~4/24 coverage gap (Drift D6). Strong ∥ candidate with P3.

---

## P5 — Doc-drift cleanup + package consolidation

**Cheap, compounding, do-anytime.** Full list in [[2026-06-03-architecture-drift-register]].
- Fix `architecture-reference` + `architecture-audit` skills: `strategies/kernel/` → `kernel/` (D1).
- Create or delete the `FRAMEWORK_INDEX.md` reference (D2) — point skills at [[Framework-Architecture-Index]].
- Patch North Star §4.3 (Learn wired) + §5.2 (runner.ts 771 LOC) (D3).
- Remove dead `projectResultForPrompt` reference from context-assembly spec (D4).
- Package consolidation 35→~22 per North Star §5.4 (verification→verify/, prompts→reasoning/context, interaction→runtime, benchmarks+scenarios→testing, health→observability). Each is a multi-file move → **plan-gated, not ad-hoc**.

**Validation gate:** every skill/spec path resolves; `ls packages/ | wc -l` trends toward 22; no broken imports.

---

## P6 — Close Phase D/E/F empirical gates (v1.0 credibility)

`[from-spec]` — proof work, lower urgency than the wiring above.
- **Phase D:** `code-action.ts` strategy exists; prove ≥20% accuracy lift + ≥25% token reduction on qwen3:14B (10-task suite), else mark `_unstable_` opt-in.
- **Phase E:** per-provider tool-call parser (thinking-mode + tool_calls coexistence regression); tool-result paging (50KB/200KB caps at `attend/context-utils.ts`).
- **Phase F:** ≥1 reproducible third-party benchmark (τ²-bench retail) with model+provider+date pinned, ≥3-seed variance, raw JSONL.

**Validation gate:** North Star Phase D/E/F gates as written (§6).

---

## Execution discipline

- Every P validated by the **N=3 corpus rule** (single runs are not evidence).
- Every default-on change clears the **lift rule** (≥3pp ∧ ≤15% overhead) or ships opt-in.
- **§4.4 surface rule** enforced: nothing in this plan adds a surface without a live consumer in the same commit — the whole point of P1–P4 is to *close* existing violations, not create new ones.
- Re-verify [[Framework-Architecture-Index]] §-level commands before/after each P; update the index in the same commit.
