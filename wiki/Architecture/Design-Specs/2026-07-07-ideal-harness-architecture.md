# Ideal Harness Architecture vs Current — 2026-07-07

**Trigger:** post-bottleneck-waves question: what is the ideal RA harness design, and how does it differ from what exists? Evidence base: B1–B5 + FM#3 + P1–P4 fix waves (2026-07-07), A1–A4 analyses, qwen3:14b/cogito:8b bench.

## The diagnosis the fix waves prove

Every bottleneck fixed on 2026-07-07 was one disease with different symptoms: **invariants and cross-cutting concerns are owned per-strategy (mechanism × policy entangled), so every guarantee must be manually replicated N times and silently holds in only some places.**

- P1: thinking-aware budgets needed at **12 call sites** — because every strategy hand-assembles its own `llm.complete()` calls. (Fixed at the Ollama choke point — which worked precisely BECAUSE it is a single mediated path.)
- P2: traceContext hand-threaded at **9 sites** — because run identity is parameter-passed, not ambient.
- P3: grounded-terminal held in the react loop but **not** in plan-execute — because termination authority is per-strategy, not architectural.
- P4: strategy switch lost tool results + toolsUsed — because each strategy owns private state shape; a switch is a teardown, not a policy swap.
- Two compaction paths, duplicated synthesis prompts (plan-execute ×2, blueprint ×1), meta-tool boolean sprawl — same disease.
- A1 headline: kernel value is model-conditional (+11pp weak, −22pp strong pre-fix) but the harness applies the same machinery to every model — because composition is static and model-blind.

## Ideal architecture (9 pillars)

### 1. One agentic core loop; strategies become policies
Single loop implementation: **perceive → decide → act → verify → terminate**. "Strategies" are parameterizations (policies) of that loop: plan-execute = front-loaded planning policy; ToT = branching decide policy; reflexion = post-act critique policy; reactive = minimal policy set. One loop means every invariant (grounding gate, budgets, carryover, tracing) holds in ALL strategies **by construction** — P3 becomes impossible to regress.

**Current:** 8 parallel strategy implementations, each with its own loop, synthesis prompts, LLM call sites, and state. The kernel loop exists but only react-family flows through it fully.

### 2. One LLM gateway
Every model call flows through a single mediated path that owns: thinking-aware output budgets, varied retries (never byte-identical), ambient trace correlation, prompt-cache-stable assembly, cost/token accounting, model routing. Call sites say WHAT (messages, purpose, schema); the gateway decides HOW.

**Current:** observable-llm wraps calls for tracing, and the Ollama adapter now owns num_predict widening — but call sites still hand-pick maxTokens/temperature/traceContext, which is why P1/P2 were N-site rollouts.

### 3. Ambient run context (Effect FiberRef)
taskId / runId / iteration / budget flow implicitly through the fiber. No parameter threading, no `llm-direct` placeholder ever again. Effect-TS makes this nearly free — RA already stands on Effect but under-uses its context machinery for exactly the concern it solves.

**Current:** `traceContext` optional field threaded by hand; P2 patched 9 sites and the next new call site can still forget it.

### 4. Unified evidence ledger
One append-only record of run facts: tool invocations + results, claims, verdicts, harness signals, checkpoints. Everything else is a **projection**: LLM-visible messages = curator projection; strategy state = view; compaction = re-projection (lossless by construction, protected classes trivial); resume = replay; receipts/honesty labels = queries. Strategy switch carries everything because there is nothing strategy-private to lose.

**Current:** proto-ledger exists — the two-record insight (`messages[]` vs `steps[]`) is the right instinct — but fragmented across steps, scratchpad (shared mutable Ref!), plan.steps, and strategy-local variables. P4's fix (copy 8 steps + toolsUsed across a switch) is a patch over the fragmentation.

### 5. Single termination authority
One gate chain owns run completion for every policy: candidate answer + evidence ledger → grounding check → requirement coverage → (optional) independent checker → verifier → accept / redirect-with-guidance / honest abstention. Abstention is a first-class terminal, not a failure.

**Current:** `terminate.ts` is single-owner for the react kernel (good); plan-execute/blueprint accept via their own reflect verdicts — P3 bolted the gate onto plan-execute ad-hoc; blueprint still has its own path.

### 6. Capability-conditional composition (the policy compiler)
At build time: capability table + calibration + task class → compiled harness config — which policies attach, budgets, guard thresholds, meta-tool set, checker on/off, strategy default. Strong thinking model → lean scaffold (A1: RA-minimal wins there); weak local model → full kernel (+11pp). The A1 finding, operationalized. This is RA's durable moat: nobody else ships per-model calibration + receipts to drive it.

**Current:** builder flags are static and user-chosen; capability table informs budgets (B2/P1) and tool-calling driver, but composition itself is model-blind.

### 7. Verification woven in, graded by cost
Verifier hierarchy chosen by policy: deterministic checks when the environment offers them (schema validation, re-execution, tests) → independent different-model checker (P6b) → self-critique. Same verifier interfaces run offline as the bench judge — eval and live share one verification vocabulary, so bench lift transfers directly.

**Current:** verifier gate + fabrication guard exist (prompt/heuristic level); judge-server is offline-only; P6b designed. Deterministic-verifier-first exists only in the bench (trustworthy-docs), not the live loop.

### 8. Total-order control plane
One arbitration point per iteration. ALL control actors — loop detector, entropy/RI dispatcher, guards, budget monitor, F1/F3 — submit **proposals**; an ordered resolver picks one action. Races become impossible (P5: loop-detector beating F1's abstention cannot happen when both are proposals to the same resolver).

**Current:** the 6-evaluator arbitrator chain is exactly this pattern — but only for termination. Interventions dispatch through a separate path; loop detection acts independently. Two half-control-planes race.

### 9. Compaction as one subsystem
Single compaction path, protected content classes, post-compaction self-check (did context actually shrink?), ledger-backed re-projection instead of lossy summarize-in-place.

**Current:** two uncoordinated paths, no outcome check (A4 finding, P6c–e open).

## What current RA already gets right (keep, don't rewrite)

- Effect-TS foundation — layers/fibers are the right substrate for pillars 2/3/8.
- Two-record design — the ledger's seed.
- Single-owner terminate + arbitrator chain — pillar 5/8 exist in miniature; the ideal generalizes them.
- Capability table + per-model calibration + probe-on-first-use — pillar 6's fuel, already built.
- Durable checkpoint/resume + HITL + receipts — ahead of every competitor surveyed (A4).
- Meta-tool registry, curator, judge-server — correct seams, wrong reach.
- The bench + amplified improvement loop — the selection pressure that makes any of this verifiable.

## Migration path (evidence-gated, no big-bang)

Order chosen so each wave makes the next cheaper, each gated by bench lift:

1. **LLM gateway** — grow observable-llm into the full mediator (budgets, varied retry, routing). Deletes the P1/P2 class. Mechanical, high certainty.
2. **Ambient context** — FiberRef for run identity/budget; delete threaded params as they become redundant.
3. **Termination authority** — extract the react gate chain + P3's plan-execute gate into one shared service; blueprint adopts it. Deletes the P3 class.
4. **Evidence ledger** — unify steps + scratchpad + plan state behind one append-only log with projections; curator/compaction/receipts re-point at it. Biggest single win for auditability + consistency.
5. **Control plane merge** — interventions + loop detector become arbitrator proposals. Deletes the P5 class.
6. **Policy compiler** — capability-conditional composition; ship as `.withAdaptiveHarness()` opt-in, ablate per tier, then default-on via lift gate.
7. **Strategy → policy refactor** — LAST, once 1–6 have hollowed the strategies into thin policy shims; done strategy-by-strategy (plan-execute first, it duplicates the most).

Anti-goals: no rewrite-from-scratch; no new strategy frameworks (LATS/GoT stay dead per spike verdicts); nothing default-on without the cross-tier lift rule.

## One-line answer

**Ideal RA = one loop, one gateway, one ledger, one terminal gate, one control plane — composed per-model by a policy compiler reading the calibration RA already owns. Current RA has every ingredient but distributes the guarantees across 8 strategy implementations; the fix waves of 2026-07-07 are the empirical proof that centralizing them is where the next capability jump lives.**
