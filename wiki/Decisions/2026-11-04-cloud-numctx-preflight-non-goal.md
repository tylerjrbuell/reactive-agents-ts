---
type: decision
status: accepted
created: 2026-11-04
tags: [head-truncation-guard, cloud-providers, num_ctx, context-window]
---

# Decision: no cloud-provider num_ctx preflight (GH #242)

**Question.** The W2e head-truncation guard is scoped to `provider == "ollama"`. Should cloud-tier agents also get a preflight (a: reject-early, b: shrink-ladder, c: documented non-goal)?

**Decision: (c) non-goal.** Cloud providers are not covered by the guard.

**Why.**
- The guard exists to stop a *silent* failure: Ollama head-truncates the system prompt at `num_ctx` and the agent keeps running lobotomised, every budget gate green. Cloud providers do the opposite: they reject an oversized request with a context-window error. The failure is loud, typed at the provider boundary, and surfaces through the normal LLM error path, so nothing is silently wrong.
- The estimator is approximate (the guard docblock records a ~35% undercount on dense content before the W2c correction, and a deliberate over-fire headroom). Local, an over-fire costs one tool; on cloud a reject-early gate would false-reject runs the provider would have accepted, converting a recoverable provider error into a framework refusal before any spend. That is the wrong direction for a gate we cannot calibrate per provider.
- A cloud shrink-ladder would silently drop tools and history on a window the provider enforces precisely. The provider's own error is the better signal.

**Consequence.** An oversized cloud prompt fails with the provider's context-window error mid-run (visible, diagnosable with `rax-diagnose cause`). Revisit only if per-provider token counting (not the chars/4 family estimator) becomes available in the Capability registry; then option (a) with an exact count is safe.

**Related.** `packages/reasoning/src/kernel/capabilities/reason/head-truncation-guard.ts`, #241 (effective window), W2e report.
