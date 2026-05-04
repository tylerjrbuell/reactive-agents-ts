# Phase 1 — Mechanism Validation Sweep: Detailed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to execute this plan. All 13 mechanisms dispatch in parallel (independent subagents, single message). Each subagent produces a spike report + recommendations. Two-stage review per mechanism: subagent → main agent verification → commit.

**Master plan:** `docs/superpowers/plans/2026-05-03-v1-master-roadmap.md` §3 Phase 1  
**Prior context:** Phase 0 complete (frozen judge); `harness-reports/phase-0-frozen-judge-2026-05-03.md` + `PHASE-0-FINDINGS-FOR-PHASE-1.md`  
**Date started:** 2026-05-03

---

## Phase 1 Philosophy

**Improve through validation, not validate to kill.** Every mechanism is a candidate for:
- **Keep** (spike proves effectiveness, earning its keep)
- **Simplify** (spike reveals unnecessary complexity; redesign to minimal core)
- **Improve** (spike shows partial effectiveness; iterate design to close gaps)
- **Remove** (spike proves harmful or impossible to make valuable; documented removal with migration path)

**No mechanism is sunset without evidence.** No mechanism is kept without evidence. Spike research is the only authority.

---

## Mandatory TDD Compliance

**All spike code follows `superpowers:test-driven-development`:**
1. Write failing test FIRST (red phase) — test the spike scenario, not the mechanism in isolation
2. Confirm it fails for the right reason
3. Implement minimal code to make it pass (green phase)
4. Refactor for clarity (if needed)
5. Commit with TDD-phase summary in commit message

**Concrete requirements:**
- File header: `// Run: bun test packages/<pkg>/tests/<file>.test.ts --timeout 15000`
- Every `it(…)` ends with `, 15000)` timeout
- Error-path tests use `Effect.flip` (not try/catch)
- Server teardown: `afterAll(async () => { await server?.stop(true); })`
- Layer isolation: `makeTestLayer()` factory, never shared mutable state
- Mocks: prefer `@reactive-agents/testing` mocks; real services only when spike requires it

---

## Mechanism Inventory & Spike Design

**13 mechanisms, 13 parallel subagents, single dispatch message.**

Each mechanism section:
- **Purpose** — what it does, where it lives, why it exists
- **Failure modes addressed** — from audit FM-A1/B2/etc.
- **Current state assessment** — working/partial/broken
- **Domain owner** — who designs + oversees the spike
- **Spike scenario** — concrete test case (not abstract "does it work?")
- **Success criteria** — quantified threshold for "earn its keep"
- **Improvement targets** — if underperforming, what should change?
- **Running spike log** — update as work progresses

---

### M1: Reactive Intelligence Dispatcher (entropy → intervention)

**Purpose:** RI dispatcher fires based on heuristics (entropy thresholds, control signals); generates interventions (nudges, strategy switches) that the kernel consumes.  
**Location:** `packages/reactive-intelligence/src/` + hooks in `packages/reasoning/src/kernel/`  
**Failure modes addressed:** FM-B1 (mitigated per Apr 30 bench), FM-A2/H1 (open)

**Current state assessment:**
- 6 RI hooks wired at `builder.ts:2673-2731`
- Event firing confirmed at `core/services/event-bus.ts:1001-1005`
- Budget tracking at `reactive-observer.ts:283-321`
- **Unknown:** whether interventions actually reduce failure rates; entropy signal quality

**Domain owner:** @reactive-intelligence package lead (Reactive Intelligence team)

**Spike scenario:**
1. Run regression-gate session with RI enabled vs. disabled (via `withReasoning({ enableRI: true/false })`)
2. Measure: (a) FM-A2 recovery rate (task accuracy when RI fires); (b) FM-B1 entropy distribution (is entropy signal meaningful?); (c) intervention latency (does nudge arrive in time?)
3. Test on qwen3:14B (local tier) + claude-haiku (frontier) to compare behavior across models
4. Capture: RI event trace logs, intervention timings, outcome deltas

**Success criteria:**
- RI-enabled runs show ≥8% accuracy lift on FM-A2 scenario (model confusion recovery)
- OR RI-enabled runs show measurable entropy normalization (entropy doesn't spike unexpectedly)
- AND no regression on tasks where RI is neutral (within ±2%)

**Improvement targets (if underperforming):**
- If entropy signal is noisy: retrain signal calibration against model-specific baselines
- If interventions are late: optimize dispatcher firing frequency
- If budget constraints limit firing: expand budget or prioritize critical interventions

**Running spike log:**
- [ ] Spike design review (domain owner sign-off)
- [ ] RED: Write failing test (RI-enabled vs. disabled comparison)
- [ ] GREEN: Implement minimal measurement instrumentation
- [ ] Verify on local tier (qwen3)
- [ ] Verify on frontier (claude-haiku)
- [ ] Analysis & recommendations
- [ ] Commit: `feat(spike): m1-ri-dispatcher validation — <verdict>`

---

### M2: Strategy Switching (ReAct ↔ Plan-Execute ↔ ToT)

**Purpose:** When task intent or progress suggests a different strategy would be better, kernel switches strategies mid-run.  
**Location:** `packages/reasoning/src/strategies/`, switching logic in `kernel/loop/runner.ts`  
**Failure modes addressed:** FM-B2 (multi-step task complexity), FM-D2 (open — when is switching optimal?)

**Current state assessment:**
- 6 strategies implemented (reactive, plan-execute, tree-of-thought, reflexion, adaptive, plan-prompts)
- Switching disabled by default (`strategySwitching: { enabled: false }` at `strategies/reactive.ts:70`)
- **Unknown:** whether switching actually improves outcomes; cost of switching vs. staying

**Domain owner:** @reasoning package lead (Reasoning/Kernel team)

**Spike scenario:**
1. Curate a 10-task suite where single-strategy fails but multi-strategy succeeds (e.g., simple tasks → ReAct, complex tasks → ToT)
2. Run each task with: (a) fixed strategy; (b) switching enabled (auto-switch when heuristic fires)
3. Measure: accuracy lift, token cost, step count
4. Test on qwen3:14B + frontier to see if switching is model-dependent
5. Log: switching decisions, strategy transitions, outcome per task

**Success criteria:**
- Switching-enabled runs show ≥10% accuracy lift on the multi-strategy suite
- Token cost increases <15% (switching has overhead; must be worth it)
- OR switching has zero effect but costs <5% tokens (keep for now, mark for future optimization)
- If switching regresses: return to fixed-strategy baseline

**Improvement targets (if underperforming):**
- If switching is late: tighten heuristic thresholds or add early-exit signal
- If switching is thrashing: add hysteresis (don't re-switch within N steps)
- If token cost is high: optimize strategy transition code or use cheaper strategies

**Running spike log:**
- [ ] Spike design review (domain owner sign-off)
- [ ] RED: Write failing test (multi-task suite with switching on/off)
- [ ] GREEN: Implement measurement + switching instrumentation
- [ ] Verify on local tier (qwen3)
- [ ] Verify on frontier (claude-haiku)
- [ ] Analysis & recommendations
- [ ] Commit: `feat(spike): m2-strategy-switching validation — <verdict>`

---

### M3: Verifier + Retry

**Purpose:** After each action, verifier checks whether task made progress or got stuck; retries with modified context if stuck.  
**Location:** `packages/reasoning/src/kernel/capabilities/verify/`  
**Failure modes addressed:** FM-A1 (mitigated per spike p01b), FM-C2 (control hook)

**Current state assessment:**
- Verifier wired for cogito:8b (spike p01b: 5/5 reject on "agent-took-action" check)
- Verifier-driven retry on cogito:14b KILLS model (spike p02)
- **Unknown:** why retry kills cogito; how to fix without regression

**Domain owner:** @reasoning package lead (Reasoning/Kernel team)

**Spike scenario (extend p01b findings):**
1. Run p01b scenario (cogito:8b "agent-took-action" rejection) but with retry OFF initially
2. Then enable retry with modified context (e.g., simplified prompt, examples removed)
3. Measure: did retry recover? did it succeed without killing the model?
4. Expand to claude-haiku (frontier) to see if retry helps or hurts
5. Log: verification outcomes, retry success rate, output quality before/after

**Success criteria:**
- Verifier correctly identifies "agent-took-action" failure (≥90% precision on labeled dataset)
- Retry succeeds on ≥50% of identified failures (recovers from stuck state)
- OR retry on frontier shows ≥5% accuracy lift vs. no-retry baseline
- If retry still kills cogito: document why and mark as model-specific limitation

**Improvement targets (if underperforming):**
- If retry doesn't help: redesign retry context (different examples, different temperature)
- If false positives (verifier flags success as failure): tighten verification heuristics
- If retry is expensive: gate retry on confidence score (only retry high-confidence failures)

**Running spike log:**
- [ ] Spike design review (domain owner sign-off)
- [ ] RED: Write failing test (extend p01b + p02 scenarios)
- [ ] GREEN: Implement improved retry context
- [ ] Test on cogito:8b (regression vs. p01b/p02)
- [ ] Test on frontier (claude-haiku)
- [ ] Analysis & recommendations
- [ ] Commit: `feat(spike): m3-verifier-retry validation — <verdict>`

---

### M4: Healing Pipeline (4 stages for FC failures)

**Purpose:** When function calling fails (malformed JSON, missing args, etc.), healing pipeline attempts to recover via 4 stages: (1) retry, (2) reparse, (3) interpolate, (4) fallback tool.  
**Location:** `packages/tools/src/` (NativeFCDriver, TextParseDriver)  
**Failure modes addressed:** FM-A2 (model function-calling unreliability — claimed but unvalidated)

**Current state assessment:**
- 4-stage pipeline implemented
- **Unknown:** Does healing actually prevent tool failures? What's the recovery rate per stage? Cost vs. benefit?

**Domain owner:** @tools package lead (Tools team)

**Spike scenario:**
1. Curate a 15-task suite where models make FC errors (malformed JSON, type mismatches, etc.)
2. Run with: (a) healing OFF (raw FC errors); (b) healing ON (4-stage recovery)
3. Measure: (a) tool invocation success rate per stage; (b) accuracy impact (does recovery hurt quality?); (c) token cost per recovery attempt
4. Test on qwen3:14B (local, known FC issues) + frontier
5. Log: FC error types, recovery stage effectiveness, fallback usage rate

**Success criteria:**
- Healing-enabled runs recover ≥60% of FC failures (tool invocation success rate improves from baseline)
- Accuracy on the suite improves ≥5% with healing
- Token cost increases <20% (recovery has overhead; must be justified)
- OR if recovery fails: document which error types are unrecoverable and mark those as "known limitations"

**Improvement targets (if underperforming):**
- If recovery rate is low: redesign stage logic (e.g., try LLM-assisted reparse instead of regex)
- If accuracy drops: healing may be "correcting" in the wrong direction; add validation before accepting recovery
- If token cost is high: make healing opt-in for expensive models; keep for cheap models

**Running spike log:**
- [ ] Spike design review (domain owner sign-off)
- [ ] RED: Write failing test (FC error dataset + healing on/off)
- [ ] GREEN: Implement measurement instrumentation
- [ ] Test on local tier (qwen3)
- [ ] Test on frontier (claude-haiku)
- [ ] Analysis & recommendations
- [ ] Commit: `feat(spike): m4-healing-pipeline validation — <verdict>`

---

### M5: Context Curation (dual compression)

**Purpose:** Two-stage compression: (1) tool-execution (stash old tool results), (2) context-compressor (abstract repeated observations). Reduces context bloat.  
**Location:** `packages/reasoning/src/kernel/utils/`, `context-curator.ts`, `context-compressor.ts`  
**Failure modes addressed:** FM-F1 (context pressure — dual systems were uncoordinated per Apr 29 audit, now confirmed coordinated)

**Current state assessment:**
- Three-stage pipeline (stash → curator → patch) confirmed coordinated (May 1)
- **Unknown:** Does compression actually improve accuracy or just reduce tokens? What's the quality tradeoff?

**Domain owner:** @reasoning package lead (Reasoning/Kernel team)

**Spike scenario:**
1. Run regression-gate session with: (a) compression OFF; (b) compression ON
2. Measure: (a) compression ratio (context size reduction %); (b) accuracy impact (does abstraction hurt quality?); (c) token savings; (d) compression latency
3. Vary compression aggressiveness (tight vs. loose thresholds) to find sweet spot
4. Test on qwen3:14B + frontier
5. Log: compression events, context size before/after, quality deltas

**Success criteria:**
- Compression reduces context size ≥30% (meaningful bloat reduction)
- Accuracy remains within ±2% of non-compressed baseline (abstraction doesn't hurt quality)
- OR accuracy improves (compression removes noise)
- Token savings justify compression overhead (≥5% net savings)

**Improvement targets (if underperforming):**
- If compression ratio is low: loosen thresholds or add more observation types to compressible set
- If accuracy drops: abstractions are too aggressive; refine compressor logic
- If latency is high: move compression to background or make it async

**Running spike log:**
- [ ] Spike design review (domain owner sign-off)
- [ ] RED: Write failing test (compression on/off comparison)
- [ ] GREEN: Implement measurement instrumentation
- [ ] Test baseline (regression-gate)
- [ ] Vary compression aggressiveness
- [ ] Test on local + frontier
- [ ] Analysis & recommendations
- [ ] Commit: `feat(spike): m5-context-curation validation — <verdict>`

---

### M6: Skill System (lifecycle, AgentEvents, RI hooks)

**Purpose:** Skills are composable capabilities with lifecycle hooks (activate, execute, refine, conflict-resolve) and event bindings; enables learning and adaptive behavior.  
**Location:** `packages/reasoning/src/`, `packages/reactive-intelligence/src/`  
**Failure modes addressed:** None directly; learning pillar

**Current state assessment:**
- Skill system wired
- 6 RI hooks for skill events exist
- **Unknown:** Do skills actually enable "learning"? What measurable outcome is "learning"? Are hooks actually used?

**Domain owner:** @reasoning package lead + @reactive-intelligence lead (cross-team)

**Spike scenario:**
1. Define a concrete "learning" scenario: e.g., "model learns to use a new tool and applies it without prompting on follow-up tasks"
2. Implement a skill that tracks tool usage and "learns" when a tool is helpful
3. Run a multi-turn task suite where skill should activate + refine across turns
4. Measure: (a) does skill activate when expected?; (b) does refine hook fire?; (c) does learning transfer to new tasks?
5. Log: skill lifecycle events, hook firings, learning outcomes

**Success criteria:**
- Skill lifecycle works (activate → execute → refine cycle completes)
- At least one RI hook fires during skill execution (e.g., onSkillActivated)
- Learning transfer visible: skill knowledge applies to ≥60% of follow-up tasks
- OR if learning doesn't transfer: document why and mark skills as "immediate use only" (no cross-task learning)

**Improvement targets (if underperforming):**
- If hooks don't fire: wire missing subscribers to skill events
- If learning doesn't transfer: redesign skill state machine (may need skill persistence across sessions)
- If skills are complex: simplify lifecycle (reduce from 4 hooks to 2 most-critical)

**Running spike log:**
- [ ] Spike design review (domain owners sign-off)
- [ ] RED: Write failing test (skill lifecycle + learning transfer)
- [ ] GREEN: Implement test skill + measurement
- [ ] Test lifecycle (activate → refine)
- [ ] Test learning transfer
- [ ] Analysis & recommendations
- [ ] Commit: `feat(spike): m6-skill-system validation — <verdict>`

---

### M7: Calibration (3-tier, observation store)

**Purpose:** Calibration system stores per-model performance data (3 tiers: frontier, mid-tier, local). Used to gate mechanisms (e.g., disable parallelCallCapability if model can't parallel-call).  
**Location:** `packages/reactive-intelligence/src/`, `packages/llm-provider/src/`  
**Failure modes addressed:** FM-A2 (calibration reliability)

**Current state assessment:**
- 3-tier structure with 14 calibration fields
- Audit found only 3/14 fields actively consumed (parallelCallCapability, interventionResponseRate, knownToolAliases)
- **Unknown:** Why are 11 fields unused? Should they be activated or removed?

**Domain owner:** @reactive-intelligence package lead (Reactive Intelligence team)

**Spike scenario:**
1. Audit all 14 calibration fields; for each, identify: (a) what it's supposed to do; (b) where it's supposed to be consumed; (c) if it's actually consumed
2. For each unused field: (a) design a spike to activate it (add a real consumer); (b) measure impact on that consumer
3. For fields that can't find a real consumer: mark for removal
4. Success = ≥8 of 14 fields have real, documented consumers with measurable impact

**Success criteria:**
- ≥8 of 14 calibration fields have active consumers (code that reads + acts on field)
- Each active field shows measurable impact on at least one mechanism (e.g., "parallelCallCapability gates M12 hook-firing")
- OR document removal justification for unused fields (not every field is needed)
- No regression in mechanism accuracy when calibration is active

**Improvement targets (if underperforming):**
- If fields are unused: either remove them (shrink) or redesign field to be useful
- If calibration is ignored by mechanisms: add assertions/tests that calibration is actually consumed
- If calibration data is inaccurate: retrain baselines on current models

**Running spike log:**
- [ ] Spike design review (domain owner sign-off)
- [ ] RED: Write audit test (list all 14 fields + consumers)
- [ ] GREEN: Implement activation spikes for top 8 high-value fields
- [ ] Verify each activated field improves its consumer
- [ ] Remove or redesign unused fields
- [ ] Test no regression
- [ ] Commit: `feat(spike): m7-calibration validation — <verdict>`

---

### M8: Sub-agent Delegation (agent-tool-adapter)

**Purpose:** Agent can spawn sub-agents to handle complex sub-tasks; sub-agent result is returned to parent agent as tool result.  
**Location:** `packages/tools/src/`, `packages/runtime/src/` (agent-tool-adapter)  
**Failure modes addressed:** FM-G1 (unvalidated)

**Current state assessment:**
- agent-tool-adapter implemented
- **Unknown:** Does delegation improve outcomes on multi-step tasks? What's the cost? When is it better than inline execution?

**Domain owner:** @tools package lead + @runtime lead (cross-team)

**Spike scenario:**
1. Design a 10-task suite of complex multi-step scenarios (e.g., "research + write summary")
2. Run each task: (a) all inline (parent agent does all steps); (b) with delegation (parent spawns sub-agent for complex step)
3. Measure: accuracy, token cost, latency, sub-agent quality
4. Test on qwen3:14B (can local models handle sub-agent spawning?) + frontier
5. Log: delegation decisions, sub-agent outcomes, when delegation helped vs. hindered

**Success criteria:**
- Delegation-enabled runs show ≥10% accuracy lift on multi-step suite
- OR delegation shows token savings ≥15% (specialization pays off)
- OR if delegation doesn't help: document why and keep as opt-in only
- Sub-agent failures don't cascade (parent can recover)

**Improvement targets (if underperforming):**
- If delegation is slow: optimize context passing (reduce parent→sub overhead)
- If sub-agent quality is low: provide better sub-task specification or examples
- If delegation is risky: add validation layer (parent checks sub-result before accepting)

**Running spike log:**
- [ ] Spike design review (domain owners sign-off)
- [ ] RED: Write failing test (multi-step task suite)
- [ ] GREEN: Implement delegation measurement
- [ ] Test on local tier (qwen3)
- [ ] Test on frontier
- [ ] Analysis & recommendations
- [ ] Commit: `feat(spike): m8-sub-agent-delegation validation — <verdict>`

---

### M9: Termination Oracle (Arbitrator)

**Purpose:** Single-owner termination gateway; all paths to `status:"done"` flow through arbitrator (FM-D1 blocker, resolved May 1).  
**Location:** `packages/reasoning/src/kernel/loop/terminate.ts`  
**Failure modes addressed:** FM-D1 (9-path scatter → single-owner fix committed)

**Current state assessment:**
- ✅ **ALREADY FIXED (May 1):** Single-owner termination wired at `terminate.ts`
- All 8 bypass sites in `runner.ts` routed through arbitrator
- **Spike scope:** Quick validation that fix actually works

**Domain owner:** @reasoning package lead (Reasoning/Kernel team)

**Spike scenario:**
1. Verify arbitrator is called before every termination (instrumentation + test)
2. Ensure no new termination paths are added (CI lint to prevent regressions)
3. Validate arbitrator logic is sound (doesn't falsely extend or prematurely terminate)
4. Test on regression-gate suite to ensure no behavioral change

**Success criteria:**
- 100% of terminations go through arbitrator (instrumentation confirms)
- No false positives (arbitrator doesn't extend valid terminations)
- No false negatives (arbitrator doesn't prematurely terminate)
- All existing tests pass

**Improvement targets (if issues found):**
- If arbitrator is bypassed: add strict CI lint to prevent future bypasses
- If logic is flawed: refine arbitrator decision criteria

**Running spike log:**
- [ ] Spike design review (domain owner sign-off)
- [ ] RED: Write test (verify arbitrator called on all paths)
- [ ] GREEN: Add instrumentation + test
- [ ] Verify no behavioral change
- [ ] Test regression-gate
- [ ] Commit: `test(spike): m9-termination-oracle validation — <verdict>`

---

### M10: Memory System (Working/Semantic/Episodic)

**Purpose:** Three-tier memory (working: current task context; semantic: cross-task knowledge; episodic: past experiences) supports agent continuity.  
**Location:** `packages/memory/src/`  
**Failure modes addressed:** FM-F2 (theoretical)

**Current state assessment:**
- Memory system architecture exists
- **Unknown:** Is it actually used? Do agents remember across tasks? Does memory improve accuracy?

**Domain owner:** @memory package lead (Memory team)

**Spike scenario:**
1. Design a multi-turn task suite where agent should remember from prior turns (e.g., "user tells agent their preference in task 1, task 2 should apply preference without re-asking")
2. Run with: (a) memory OFF; (b) memory ON (episodic storage + recall)
3. Measure: (a) does agent recall correctly?; (b) accuracy improvement from memory?; (c) memory overhead
4. Test on qwen3:14B + frontier
5. Log: memory storage events, recall success, accuracy delta

**Success criteria:**
- Memory system works (store + recall cycle completes without errors)
- Episodic recall accuracy ≥80% (agent remembers what it should)
- Accuracy lift ≥5% on multi-turn suite vs. no-memory baseline
- OR if memory doesn't help on this suite: design different scenario (may need longer-horizon tasks)

**Improvement targets (if underperforming):**
- If recall is inaccurate: improve indexing or semantic matching for memory retrieval
- If accuracy doesn't improve: memory isn't being used; redesign trigger for memory recall
- If overhead is high: batch memory operations or use sparse indexing

**Running spike log:**
- [ ] Spike design review (domain owner sign-off)
- [ ] RED: Write failing test (multi-turn memory scenario)
- [ ] GREEN: Implement measurement
- [ ] Test on local tier (qwen3)
- [ ] Test on frontier
- [ ] Analysis & recommendations
- [ ] Commit: `feat(spike): m10-memory-system validation — <verdict>`

---

### M11: Diagnostic System (Sprint 3.6 output leak fix)

**Purpose:** Diagnostic system monitors agent internals for leaks (e.g., system prompts leaked to output, API keys in logs). Sprint 3.6 added output leak detection.  
**Location:** `packages/diagnose/src/`  
**Failure modes addressed:** FM-A3 (output leak fix)

**Current state assessment:**
- Diagnostic system exists with output leak detection
- **Unknown:** Does it actually catch leaks? What's the false positive / false negative rate?

**Domain owner:** @diagnose package lead (Observability team)

**Spike scenario:**
1. Create synthetic test dataset: (a) clean outputs; (b) outputs with intentional system prompt leaks; (c) outputs with API key patterns
2. Run diagnostic system on dataset
3. Measure: (a) true positive rate (catches actual leaks); (b) false positive rate (flags clean output); (c) detection latency
4. Measure on different output types (text, JSON, markdown)

**Success criteria:**
- True positive rate ≥95% (catches ≥95% of intentional leaks)
- False positive rate ≤5% (doesn't flag clean output)
- Detection latency <100ms
- OR if detection is imperfect: document which leak types are detected and which aren't

**Improvement targets (if underperforming):**
- If true positives are low: expand pattern library or use LLM-based detection
- If false positives are high: tighten patterns or add context-aware filtering
- If latency is high: optimize regex or add caching

**Running spike log:**
- [ ] Spike design review (domain owner sign-off)
- [ ] RED: Write failing test (synthetic leak dataset)
- [ ] GREEN: Implement measurement
- [ ] Test detection accuracy
- [ ] Test latency
- [ ] Analysis & recommendations
- [ ] Commit: `test(spike): m11-diagnostic-system validation — <verdict>`

---

### M12: Provider Adapter System (7 hooks)

**Purpose:** 7-hook adapter system lets each LLM provider (Anthropic, Ollama, Gemini, etc.) customize behavior: (1) parseToolCalls, (2) extractText, (3) computeCost, (4) validateResponse, (5) optimizePrompt, (6) handleError, (7) streamSupport.  
**Location:** `packages/llm-provider/src/`  
**Failure modes addressed:** Quality-of-life across all provider tiers

**Current state assessment:**
- ✅ **ALL 7 HOOKS WIRED (Apr 30):** Confirmed in audit findings
- **Spike scope:** Validate each hook actually fires and improves its domain

**Domain owner:** @llm-provider package lead (LLM Provider team)

**Spike scenario:**
1. For each hook, verify: (a) it fires on provider-specific scenarios; (b) it improves the domain it controls
2. Example hook tests:
   - **parseToolCalls:** qwen3 malformed tool_calls → parseToolCalls normalizes → success
   - **extractText:** Gemini streaming parts → extractText reassembles → output correct
   - **computeCost:** each provider → computeCost returns accurate token pricing
   - **validateResponse:** invalid response → validateResponse catches → error handled
   - **optimizePrompt:** raw prompt → optimizePrompt adds provider-specific tips → better quality
   - **handleError:** provider error → handleError maps to standard error → retry logic works
   - **streamSupport:** provider streaming → streamSupport parses correctly → events fire
3. Test each hook on its primary provider
4. Log: hook firing rate, domain improvement, error handling

**Success criteria:**
- All 7 hooks fire on their intended scenarios (instrumentation confirms)
- Each hook measurably improves its domain (provider-specific tests pass)
- No regression on non-primary providers (hooks don't interfere with others)
- All existing tests pass

**Improvement targets (if issues found):**
- If hook doesn't fire: check provider-specific condition or add test case
- If domain doesn't improve: refine hook logic or add examples
- If interference occurs: add provider guards to prevent cross-provider conflicts

**Running spike log:**
- [ ] Spike design review (domain owner sign-off)
- [ ] RED: Write tests for all 7 hooks (one test per hook per primary provider)
- [ ] GREEN: Verify hooks fire + improve domains
- [ ] Test on primary providers
- [ ] Verify no cross-provider interference
- [ ] Commit: `test(spike): m12-provider-adapter-hooks validation — <verdict>`

---

### M13: Guards + Meta-tools Registry

**Purpose:** Guards prevent invalid tool calls (type checking, arg validation); meta-tools registry tracks tooling metadata (aliases, deprecations, access control).  
**Location:** `packages/reasoning/src/kernel/phases/`, `packages/tools/src/`  
**Failure modes addressed:** FM-D1 (premature termination via invalid tool — related to M9)

**Current state assessment:**
- Guards implemented
- **Unknown:** How effective are guards? What % of invalid calls do they catch? Do they false-positive?

**Domain owner:** @reasoning package lead + @tools lead (cross-team)

**Spike scenario:**
1. Create dataset of valid + invalid tool calls: (a) valid (correct type + args); (b) malformed (wrong types, missing args); (c) edge cases (null args, extra args)
2. Run through guard system
3. Measure: (a) true positive rate (catches invalid calls); (b) false positive rate (rejects valid calls); (c) guard latency
4. Test on qwen3:14B + frontier (guards should work across models)
5. Log: guard firing, rejection reasons, false positive details

**Success criteria:**
- True positive rate ≥90% (catches ≥90% of invalid calls)
- False positive rate ≤2% (rarely rejects valid calls)
- Guard latency <50ms
- Meta-tools registry provides useful aliasing (e.g., "web_search" → "search_web")

**Improvement targets (if underperforming):**
- If catching rate is low: add more validation rules or use LLM-based validation
- If false positives are high: relax rules or add context-aware exceptions
- If registry doesn't help: document which aliases are actually used

**Running spike log:**
- [ ] Spike design review (domain owners sign-off)
- [ ] RED: Write test (valid + invalid tool call dataset)
- [ ] GREEN: Implement measurement
- [ ] Test effectiveness
- [ ] Verify meta-tools registry usage
- [ ] Analysis & recommendations
- [ ] Commit: `test(spike): m13-guards-meta-tools validation — <verdict>`

---

## Phase 1 Validation Gate (Final)

**All mechanisms must have:**
1. ✅ **Spike report** — what did we test, what did we find?
2. ✅ **Verdict** — keep, simplify, improve, or remove (with justification)
3. ✅ **Running log** — progress from RED → GREEN → analysis

**Phase 1 passes if:**
1. Every mechanism (M1–M13) has a spike report + verdict
2. Mechanism improvements are implemented (if verdict is "improve" or "simplify")
3. Removed mechanisms have migration paths documented
4. All spike tests pass (TDD green phase for all 13)
5. All existing tests still pass (no regressions)
6. Aggregate harness LOC drops ≥5% (cleanup from removed/simplified mechanisms)
7. Code review passes (per superpowers:code-reviewer)

**Validation evidence artifact:** `harness-reports/phase-1-mechanism-validation-YYYY-MM-DD.md` — comprehensive report with all 13 spike results + recommendations + LOC delta

---

## Execution Protocol

**Dispatch:** All 13 subagents in parallel (single message, 13 Agent tool blocks)

Each subagent:
1. Reads this plan + the mechanism section
2. Consults domain owner for spike design confirmation (or refines design autonomously if specified)
3. Writes RED-phase test
4. Implements GREEN-phase minimal code
5. Captures running spike log (markdown in commit message)
6. Produces spike report (findings + recommendations)
7. Commits with TDD-phase summary

Main agent:
1. Collects all 13 spike reports
2. Verifies each report (read diff, run tests, check artifact)
3. Asks domain owners for verdict confirmation if recommendations are non-obvious
4. Commits each mechanism's implementation + verdict
5. Synthesizes phase validation evidence artifact
6. Code review passes → Phase 1 complete

---

## Rollback & Stop-the-Line Conditions

**Stop if:**
- 3+ consecutive mechanism spikes fail their TDD gates (may need to reframe mechanisms)
- A mechanism spike shows clear harm (negative lift, breaking changes)
- LOC increases instead of decreases (cleanup not happening)

**Remedy:**
- Revert the problematic mechanism(s)
- Reconvene with domain owner to redesign spike or mechanism
- Re-attempt after redesign

---

## Handoff to Phase 2

After Phase 1 completion:
1. Write `harness-reports/phase-1-mechanism-validation-YYYY-MM-DD.md` (evidence artifact)
2. Update `ROADMAP.md` with mechanism verdicts (which were kept, improved, removed)
3. Update `docs/spec/docs/AUDIT-overhaul-2026.md` §10 with final mechanism verdicts
4. Begin Phase 2 planning (Orchestration Decomposition) based on Phase 1 findings

---

*This plan assumes all 13 mechanisms are valuable candidates for improvement. No mechanism is pre-destined for removal. Spike research will determine the path forward.*

*Last updated: 2026-05-03 (initial creation)*
