---
title: Canonical Agentic Convergence — post-condition spine + tier-faithful harness
date: 2026-05-30
status: design-spec (approved)
related:
  - "[[2026-05-30-harness-engineering-canon]]"
  - "[[2026-05-30-reactive-agents-alignment-gap]]"
  - "[[2026-05-29-tier-aware-context-architecture]]"
  - "[[project_mcp_relevant_tools_drop_fix]]"
---

# Canonical Agentic Convergence

Bring reactive-agents' core agentic systems into a converged, canonical design so
agents — **including on local models** — complete complex multi-step tasks of all
kinds with accuracy, consistency, efficient tool use, progress comprehension, and
memory. Wire existing systems; verify every change on real models as we go.

## North Star (success criteria)
1. Local-tier agents complete complex multi-step, multi-tool tasks reliably.
2. Accuracy + **consistency** — measured `pass^k` (N≥3/tier), not `pass@1`.
3. Efficient tool use (right tool, right args, no churn, minimal tokens).
4. **Comprehension of progress** — the agent always knows goal / done / remaining.
5. Memory — relevant facts + prior successful procedures available.
6. Control-first: every adaptive mechanism overridable; honesty over false success.

## Grounding (canon → this design)
Full canon + citations: [[2026-05-30-harness-engineering-canon]]. Gap analysis +
verdicts: [[2026-05-30-reactive-agents-alignment-gap]]. The three proven failure
modes this session each map to one canonical gap: completion lie → state-grounded
verification; tool-visibility/recall churn → tool-set stability; variance →
`pass^k`. Tier-token work is the existing context campaign; model capability is a
floor the harness makes **honest**, not competent.

## Architecture — the post-condition spine
A single mechanical artifact, the **PostCondition set**, drives three jobs:

```
deriveConditions(task, requiredTools)  ─ deterministic, NO LLM ─┐
   PostCondition[] = {ToolCalled(name) | ArtifactProduced(path) | OutputContains(pat)}
        │
        ├─►  VERIFY (WS-1)   success authority: status=completed ⇔ all met (state-grounded)
        ├─►  PROGRESS (WS-4) recite "goal · done[] · remaining[]" into RECENCY each turn
        └─►  SELF-CHECK      wire remaining[] into pulse("am I ready?") meta-tool
```

Why this serves local models: it stops relying on the model to *infer* done or
*remember* progress — both are mechanical and recited. (Sources: proxy-state
arXiv 2602.16246; τ-bench; DSPy Assertions; Manus recitation; SWE-agent ACI.)

**Derivation is deterministic + conservative (high precision).** Sources, in
precedence: user-declared (designed seam, deferred) → required-tools → literal
deliverable path in the task text (`create/write a file ./X` → ArtifactProduced)
→ explicit output format. **No LLM-derived criteria** (reinherits classifier
unreliability — the demotion bug). If nothing derives, fall back to current
prose behavior → **additive, never blocks a genuinely-done non-verifiable task.**

## Workstreams (subagent-parallelizable; each has a LIVE-RUN gate)

Every WS is DONE only when its **live-run verification** passes — real models,
cross-tier, `pass^k` — not merely unit-green. Substrate: `task-quality-gate.ts`
probe (extend with `pass^k` + post-condition checks) + the spot-test GitHub-MCP
task. Tiers: local (cogito:14b, qwen3.5), mid (gpt-4o-mini), frontier (sonnet-4-6).

### WS-1 — PostConditionVerifier (spine; P1)
- Build `PostCondition` types + deterministic `deriveConditions` + `verify(state)`
  returning met/unmet. Make it the **success authority** over the prose verifier
  (prose demoted to quality signal). Generalize B (reflexion required-tools gate)
  to consume it across ALL strategies. Closes demotion-gap C without trusting the
  classifier (the path is literally in the task).
- **Check mechanism = execution-state, not raw fs.** `ToolCalled` and
  `ArtifactProduced` verify against the **tool-call ledger** (the write tool fired
  successfully with the matching path arg) — NOT `fs.existsSync`. Tools may run in
  a remote/MCP/sandboxed environment where the orchestrator's local fs is the wrong
  ground truth; the ledger is the portable, sandbox-safe signal. (Raw fs allowed
  only as an opt-in for known-local tools.)
- Wire existing: kernel verify capability, reflexion completion, `pendingGuidance`
  (unmet → steering), step ledger.
- **Live-run gate:** spot-test `success:true` becomes IMPOSSIBLE without
  `commits.md` on disk; cross-tier `pass^k` for completion honesty ↑; no
  regression on no-required tasks (still complete).

### WS-4 — Progress recitation + recency (merge into WS-1)
- Each turn, render `goal · done[] · remaining[]` (from the live condition ledger)
  into the recency span; wire `remaining[]` into `pulse`.
- Wire existing: context-curator recency section, pulse meta-tool.
- **Live-run gate:** local-tier multi-step task — agent references remaining steps
  unprompted; lost-in-the-middle drop ↓; fewer redundant re-calls. (Manus, 12-factor.)

### WS-2 — Tool-set stability (P2; ABLATION-GATED)
- Stop per-iteration tool churn. Keep tools resident; constrain via provider
  tool_choice/required (logit-mask analog); compute the visible set once and hold;
  pass the tool contract as ONE struct (kills the "forgot relevantTools" class).
- ⚠️ **Ablation first:** lazy-disclosure was empirically adopted 2026-04-26 for
  real prompt-curation gains. Canon (Manus) says mask-don't-churn. Resolve by
  measurement: churn vs stable, cross-tier `pass^k` + tokens + tool-error rate.
  Ship whichever wins; do NOT blind-flip.
- **Live-run gate:** ablation verdict with numbers; KV-cache-stable path shows
  ≤ tokens + ≥ tool-accuracy, or stays opt-in.

### WS-3 — `pass^k` reliability harness (P3; do EARLY — it gates the others)
- Extend the probe to run N≥3/tier and report `pass^k` + per-item correctness +
  post-condition pass-rate. This is the measurement substrate every other WS's
  live-run gate depends on → build first.
- **Live-run gate:** reproduces this session's variance (cogito flip-flop,
  gpt-4o-mini env-cratering) as explicit `pass^k` numbers.

### WS-5 — Remove non-canonical extras (P5)
- Ablate + remove `extractObservationFacts` where data is inline (Inc 2, 44% local
  tokens); land Inc 1 recall-gate default-on if cross-tier proven. Canon:
  clear/keep, don't pre-digest; smallest high-signal token set.
- **Live-run gate:** local tokens ↓ ≥ Inc-2 share with composite + post-condition
  pass-rate flat-or-up, cross-tier.

### WS-6 — Experience reuse / procedural memory (P6)
- On task entry, recall prior successful action-sequences for similar
  post-condition shapes; feed as a procedure hint (Voyager skill-reuse). Helps
  local tiers most — hands them the procedure they can't plan.
- Wire existing: 4-layer memory, skill store, ExperienceSummary loop.
- **Live-run gate:** local-tier repeat-task `pass^k` ↑ with the hint vs without;
  no frontier regression.

## Cross-cutting principles
- **Local-first:** every WS tuned to the weak tier (recency, minimal tokens,
  clear-don't-pre-digest, cache-stable, state-grounded retry); proven `pass^k` per tier.
- **Control-first:** every mechanism overridable; calibration fills only what the
  user didn't pin.
- **Wire existing systems; anti-scaffold (§9):** every component has a consumer in
  its own WS. No dead code.
- **Honesty:** state-grounded `success:false` over a prose lie; never fake competence.

## Sequencing
WS-3 (measurement) first → WS-1+WS-4 (the spine, the headline win) → WS-5 (cheap
token wins) → WS-2 (ablation-gated, higher-risk) → WS-6 (compounding). Each lands
behind its live-run gate before the next.

## Out of scope
Routing-on-structure (keyword router is brittle but was NOT the proven bug — defer);
file-as-externalized-memory for very long tasks; multi-agent task-typing (delegate
breadth-read / single-thread writes — codify later); LLM-derived acceptance criteria
(rejected). Model capability is a floor, not a workstream.

## Verification protocol (standing)
Per the user's directive — **live-run verification as we go.** No WS is done on
unit-green alone. Each: (1) RED unit test, (2) GREEN + rebuild, (3) **cross-tier
`pass^k` live run** (N≥3, local+mid+frontier) proving the WS's specific gate,
(4) `rax:diagnose` trace evidence, (5) advisor before declaring done. Commit per
WS with the live-run numbers in the message.
