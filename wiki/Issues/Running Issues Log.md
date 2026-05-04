---
aliases: [Active Blockers, Known Issues]
tags: [issues, blockers, active-work]
---

# Running Issues Log

**Purpose:** Canonical tracking of active blockers, known problems, pending resolutions, and historical closure notes.

**Updated:** 2026-05-04

---

## Critical Path Issues (Blocking Release)

### Issue #1: Rule 4 Frozen Judge Validation

**Status:** 🔴 BLOCKING (Phase 0 gate)

**Description:** `packages/eval/src/runtime.ts` uses same-model judge instead of separate frozen judge instance. Blocks v0.10.0 release and any published benchmark claim.

**Root Cause:** Judge LLMService not instantiated separately from benchmark SUT model.

**Impact:** 
- Cannot publish benchmark results (unfair comparison)
- v0.10.0 release blocked pending fix
- Frontier validation results preliminary only

**Reproduction:**
```bash
cd packages/benchmarks
bun run harness # Judge and SUT use same model code path
```

**Fix (5-step):**
1. Create `JudgeLLMService` wrapper in `packages/eval/src/judge-service.ts`
2. Instantiate with FROZEN model (claude-sonnet-4-6, fixed version)
3. Wire judge-server RPC instead of inline agent
4. Validate in `packages/eval/tests/rule-4-frozen-judge.test.ts`
5. Update harness report to note frozen model, date frozen

**Owner:** Benchmarking team

**Deadline:** Before v0.10.0 tag

**References:**
- [[Decisions/Phase 0 Frozen Judge|Phase 0 Frozen Judge]] 
- `docs/spec/docs/AUDIT-overhaul-2026.md` section §eval

---

### Issue #2: @reactive-agents/diagnose Publication

**Status:** 🟡 PENDING (v0.10.0 release)

**Description:** Package `packages/observability` exports `DiagnosticService` but `@reactive-agents/diagnose` not published on npm (404 confirmed May 1).

**Root Cause:** Package never published; relies on changeset auto-publish.

**Impact:**
- v0.10.0 release will include diagnose APIs but package unavailable
- Users cannot `npm install @reactive-agents/diagnose`
- Observability features blocked from npm ecosystem

**Workaround:** Import from umbrella `@reactive-agents` for now

**Fix:** 
1. Verify `packages.json` export for diagnose scoped package
2. Run changeset publish workflow for v0.10.0
3. Confirm npm registry has package within 5 min of publish

**Owner:** Release team

**Deadline:** During v0.10.0 publish workflow

**References:**
- `packages/observability/package.json`
- CI changeset workflow

---

## Known Issues (Monitoring)

### Issue #3: cogito:14b Instruction-Following Gap (FM-A1)

**Status:** 🟡 KNOWN (Phase 1.5 improvement in progress)

**Description:** cogito:14b exhibits ~15% FM-A1 frequency (no-tool fabrication) despite M13 guards.

**Root Cause:** cogito:14b doesn't consistently recognize required tool constraints in instructions.

**Impact:** 
- Task incompleteness on cogito:14b
- Guards catch errors but require costly retry loop
- cogito:14b not recommended for safety-critical tasks

**Workaround:** Use frontier model or add extra instruction emphasis in prompts

**Phase 1.5 Action:** Tune M3 retry context (prompts, temperature) for cogito:14b

**Owner:** Reasoning team

**Success Criteria:** <5% FM-A1 frequency

**References:**
- [[Failure-Modes/FM-A Tool Engagement|FM-A1: No-Tool Fabrication]]
- [[Decisions/Phase 1.5 Retry Context Tuning|M3 Retry Tuning]]

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

### Issue #5: Strategy Routing Opt-In (Default Disabled)

**Status:** 🟡 KNOWN (Phase 2 default-enabling)

**Description:** Strategy switching (M2) requires explicit opt-in via `withReasoning({ strategySwitching: { enabled: true } })`. Disabled by default.

**Root Cause:** Feature delivered as opt-in during Phase 1 to manage risk.

**Impact:**
- Users don't get strategy selection benefits by default
- Requires boilerplate configuration
- No token savings for first-time users

**Workaround:** Explicitly enable in builder config

**Phase 2 Action:** Enable strategy switching by default for multi-step tasks

**Owner:** Reasoning team

**References:**
- `packages/reasoning/src/strategies/reactive.ts:70`
- `packages/runtime/src/builder.ts:749`

---

## Resolved Issues (History)

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
- 🔄 cogito:14b FM-A1 reduced via M3 tuning
- 🔄 Phase 2 plan finalized
- 🟢 Any new issues discovered during Phase 1.5 work

---

**Last Updated:** 2026-05-04 14:27 EDT  
**Total Open:** 5 (1 critical, 4 known)  
**Resolved in Phase 1:** 4
