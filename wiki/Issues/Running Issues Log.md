---
aliases: [Active Blockers, Known Issues]
tags: [issues, blockers, active-work]
---

# Running Issues Log

**Purpose:** Canonical tracking of active blockers, known problems, pending resolutions, and historical closure notes.

**Updated:** 2026-05-12

---

## Known Issues (Monitoring)

### Issue #3: cogito:14b FM-A1 Retry Tuning — Re-scoped

**Status:** ⚪ RE-SCOPED (2026-05-12)

**Original:** cogito:14b ~15% FM-A1 frequency; tune M3 terminal retry context (prompts, temperature) to <5%.

**Re-scope reason:** M3 REWORK commit `051c22be` removed the terminal verifier retry loop. The surface this issue targeted no longer exists. `retry-context.ts`, `defaultVerifierRetryPolicy`, and `improvedVerifierRetryPolicy` remain as exported API but are no longer called by the kernel.

**Active FM-A1 mitigation:** `oracle-nudge.ts` (Pivot B, 2026-05-07) — "describe vs emit" example pair lifts cogito:14b T4 from 30% → 100% synthesized output.

**Before v0.11 cleanup needed:** Remove orphaned `KernelInput.verifierRetryPolicy` field, `retry-context.ts`, and dead exports (`defaultVerifierRetryPolicy`, `improvedVerifierRetryPolicy`, `VerifierRetryPolicy`, `VerifierRetryPolicyContext`) from public index. Delete `m3-verifier-retry.test.ts`. This is a breaking change — semver bump or v0.11 deprecation cycle.

**Owner:** Reasoning team

**References:**
- [[Failure-Modes/FM-A Tool Engagement|FM-A1: No-Tool Fabrication]]
- [[Decisions/2026-05-12-m3-terminal-verifier-rework|M3 REWORK Decision]]

---

### Issue #4: ToT Outer Loop Doesn't Honor Dispatcher Early-Stop

**Status:** 🟡 KNOWN (Phase 2 work)

**Description:** Tree-of-Thought outer loop doesn't respect dispatcher-early-stop signal. Each branch is a separate sub-kernel with independent RI dispatch.

**Root Cause:** ToT branches created before early-stop wiring; early-stop unhooked at outer loop.

**Impact:**
- ToT may continue branching even after dispatcher recommends termination
- Token waste if RI detects task completion mid-tree
- Suboptimal for deadline-constrained tasks

**Workaround:** Manually set `maxDepth` lower for time-critical tasks

**Phase 2 Action:** Wire dispatcher signal to ToT outer loop coordinator

**Owner:** Orchestration team

**References:**
- `packages/reasoning/src/strategies/tree-of-thought.ts`
- [[Concepts/Reactive Intelligence|Reactive Intelligence (RI)]]
- [[Decisions/Phase 2 Orchestration Decomposition|Phase 2 Plan]]

---


### Issue #6: M3 Verifier Ablation

**Status:** ✅ CLOSED (2026-05-12)

**Description:** Ablation benchmark ran to produce verdict for the M3 verifier mechanism. 10 tasks × 3 models × 2 variants (initial run) + clean re-run (task b36gfxia2, 5 tasks × 3 models × 2 variants, fixed judge). Verdict filed 2026-05-12. REWORK implemented in commit `051c22be` (terminal retry loop disabled, pass/fail gate retained).

**Closure summary:**
- Clean re-run (b36gfxia2) verdict: **INCONCLUSIVE** — no pre-stated rule fires at ≥2/3 model threshold
- REWORK implemented in `051c22be` and **stands** — no reversion triggered by INCONCLUSIVE result
- gpt-4o-mini showed ra-full +5pp with only +15% token overhead — meets KEEP criteria for that model; worth monitoring post-v0.11
- Issue #3 re-scoped (terminal retry surface removed by REWORK; FM-A1 mitigation via `oracle-nudge.ts` already shipped)

**Owner:** Reasoning team

**References:**
- [[Experiments/M3 Healing Pipeline|M3 Verifier]]
- [[Decisions/2026-05-12-m3-terminal-verifier-rework|M3 REWORK Decision]]
- `wiki/Research/Harness-Reports/phase-1.5-m3-ablation-2026-05-12.md` (includes clean re-run section)

---

### Issue #7: Pruning Principle Has No Builder API

**Status:** 🟡 KNOWN (Phase B/C work)

**Description:** North Star §9 encodes the empirical finding from NLAH (arXiv:2603.25723): full harness = 13.6× tokens with −0.8pp accuracy on frontier models. Despite this, `ReactiveAgents.create()` has no lean-mode opt-in. Every user runs at maximum token cost regardless of their model tier or task complexity.

**Root Cause:** Pruning Principle documented in North Star but not surfaced in the builder API. No `.withLeanHarness()` or tier-based pruning flag exists.

**Impact:**
- Users adopting the full harness stack pay 13.6× tokens with negative returns on frontier models
- No programmatic way to opt into a pruned/lean configuration
- Token cost is a show-HN concern for v0.11 positioning

**Fix:** Add `.withLeanHarness()` or tier-based pruning flag to builder before v0.11 ships.

**Phase Gate:** Phase C (v0.11 launch readiness)

**Owner:** Builder team

**References:**
- North Star §9 (Pruning Principle)
- `packages/runtime/src/builder.ts`
- NLAH arXiv:2603.25723

---

## Resolved Issues (History)

### ✅ RESOLVED: Strategy Routing Opt-In (Issue #5)

**Status:** ✅ Resolved 2026-05-12

**Issue:** Strategy switching (M2) required explicit opt-in via `withReasoning({ strategySwitching: { enabled: true } })`. Disabled by default.

**Resolution:** Gate flipped to `!== false` in `packages/runtime/src/runtime.ts` — strategy switching is now opt-OUT (enabled by default). Test updated to match.

**References:**
- `packages/runtime/src/runtime.ts`

---

### ✅ RESOLVED: Rule 4 Frozen Judge Validation

**Status:** ✅ Resolved v0.10.6

**Issue:** `packages/eval/src/runtime.ts` used same-model judge instead of a separate frozen judge instance, blocking any published benchmark claim.

**Resolution:** `packages/judge-server/` implements a separate frozen judge via `JudgeLLMService`. Runs as an HTTP RPC on port 8910, isolated from the SUT model. Benchmarks wire via `--judge-url http://localhost:8910`.

**References:**
- `packages/judge-server/`
- `packages/benchmarks/` — `--judge-url` flag

---

### ✅ RESOLVED: @reactive-agents/diagnose Publication

**Status:** ✅ Assumed resolved v0.10.6 — verify with `npm view @reactive-agents/diagnose version`

**Issue:** `@reactive-agents/diagnose` showed 404 on npm (confirmed May 1). Package `packages/observability` (name: `@reactive-agents/observability`) exports `DiagnosticService` but the scoped diagnose package was unpublished.

**Resolution:** Published via changeset CI at v0.10.6. Note: `packages/observability/package.json` name is `@reactive-agents/observability` — confirm the scoped `diagnose` package name is correct before treating as fully closed.

**References:**
- `packages/observability/package.json`
- CI changeset workflow

---

### ✅ RESOLVED: Dual Compression Uncoordinated

**Status:** ✅ Resolved (May 2, 2026)

**Issue:** Message compression and context curation were separate passes that could conflict.

**Resolution:** Three stages sequenced: stash → curator → patch
- `messages.stash` happens first (episodic memory)
- `applyContextCuration` happens second (compression)
- `patchMessageWindow` happens third (windowing)
- Regression test: `context-curator.test.ts` validates composition

**References:**
- `packages/reasoning/src/kernel/capabilities/attend/context-utils.ts`

---

### ✅ RESOLVED: 9 Termination Paths, No Single Owner

**Status:** ✅ Resolved (Apr 30, 2026)

**Issue:** Multiple code paths could terminate loop; no single decision maker.

**Resolution:** Single-owner arbitrator pattern
- `kernel/loop/terminate.ts` — single-owner helper (validates only arbitrator can terminate)
- `packages/reasoning/src/kernel/capabilities/decide/arbitrator.ts` — the authority
- All other paths defer to arbitrator
- Test: 100% path coverage enforced

**References:**
- `packages/reasoning/src/kernel/loop/terminate.ts`
- Arbitration tests

---

### ✅ RESOLVED: qwen3 Auto-Enable Thinking

**Status:** ✅ Resolved (May 1, 2026)

**Issue:** qwen3:14b thinking mode was auto-enabled globally, breaking other models.

**Resolution:** Thinking is now OPT-IN
- `resolveThinking()` at `packages/llm-provider/src/providers/local.ts:226`
- Returns `undefined` unless `configThinking === true`
- No side effects on non-qwen3 models

**References:**
- `packages/llm-provider/src/providers/local.ts:226-251`

---

### ✅ RESOLVED: RI Dispatcher Budget Zeroed

**Status:** ✅ Resolved (May 3, 2026)

**Issue:** Reactive intervention budget counters appeared dead-zeroed (stale claim).

**Resolution:** Budget counters live and accumulating
- `packages/reasoning/src/kernel/capabilities/reflect/reactive-observer.ts:283-321`
- Accumulates `riBudget` on each intervention
- Verified in Phase 1 M1 validation

**References:**
- `packages/reasoning/src/kernel/capabilities/reflect/reactive-observer.ts`

---

## How to Report Issues

1. **Is this blocking release?** → Add to Critical Path Issues with deadline
2. **Is this a known limitation?** → Add to Known Issues with Phase assignment
3. **Is this already resolved?** → Verify in Resolved Issues before reopening
4. **Do you have a fix?** → Reference the PR or commit that resolves it

---

## Triage Process

| Priority | Action | Owner | Deadline |
|----------|--------|-------|----------|
| 🔴 Blocking release | Fix immediately | Team lead | Before tag |
| 🟡 Known limitation | Phase gate assignment | Domain owner | Phase gate date |
| 🟢 Low impact | Monitor, defer | Observer | Next review |

---

## Next Review: Phase 1.5 Checkpoint (May 15, 2026)

At that point, we expect to see:
- ✅ Rule 4 frozen judge resolved
- ✅ @reactive-agents/diagnose published
- ✅ Strategy routing opt-in flipped to default-on (#5)
- 🔄 cogito:14b FM-A1 reduced via M3 retry tuning (#3)
- 🔄 M3 REWORK implementation complete — terminal retry loop removed (#6)
- 🔄 Pruning Principle builder API scoped (#7)
- 🔄 Phase 2 plan finalized
- 🟢 Any new issues discovered during Phase 1.5 work

---

**Last Updated:** 2026-05-12  
**Total Open:** 2 (#4, #7 — 0 critical, 2 known; #3 re-scoped pending v0.11 cleanup, #6 closed)  
**Resolved in Phase 1:** 7
