---
type: harness-report
status: closed
created: 2026-10-23
model: bonsai-2:27b
tags: [harness-improvement, introspective-probe]
---

# Improvement Log — 2026-10-23 (introspective harness loop)

New probe modality this pass: instead of inferring friction from traces alone, the agent was interviewed after each run (raw Ollama call, outside the harness) about how the harness affected it, and every self-report cross-checked against trace events. 6 friction-engineered tasks, local tier, single model. Full evidence: `introspective-2026-10-24-02-*.json|.md` (UTC-named). Prioritized queue: [[Planning/Recommended-Enhancements]] §2026-10-23 sweep.

**Shipped — ollama thinking off-switch (provider-warden).** `resolveThinking` collapsed `config.thinking:false` into "omit the `think` param", but Ollama runs thinking server-side when the param is absent on default-think models (bonsai-2, qwen3 family) — so the off-switch never took effect while `widenNumPredictForThinking` paid +6000 output tokens for it. Now: explicit false + capable model → `think:false` on the wire; non-capable or unset → unchanged. RED-first pins + wire-level tests + doc contract rewrite; llm-provider 511 pass / 0 fail, downstream runtime thinking tests 42/0, typecheck clean. Empirically verified on Ollama 0.40.6 pre-dispatch (`think:false` → `thinking_len=0` on bonsai, accepted by llama3.2).

**Top surfaced frictions (scored, not yet fixed):** I2 silent `maxIterations` tier-clamp (18), I5 recovery nudge advising a tool that cannot fix the failure (18), I7 shell policy denials traced as `ok=true` (18), I4 terminal-gate rejection reasons never reaching the agent — 4/6 blind spots, == the deferred verifier-driven retry loop (12), I1 sandbox split-brain file-tools-vs-shell roots, the model's #1 ask in 5/6 interviews, deliberately-designed asymmetry so needs go/no-go (9). See the queue table for citations.

**Probe-integrity notes for the next pass:** interview JSON needs the thinking-budget widening + starvation detection + brace-salvage (all baked into the script now); `crossCheck` must receive the full interview record, not a pre-extracted array (bug caught mid-session — first two runs' blind-spot tallies were computed with `reportedSurfaces=[]` and were re-derived in the final aggregation; individual early MD reports understate coverage).
