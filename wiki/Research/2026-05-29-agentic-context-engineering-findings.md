---
title: Agentic Context-Engineering Research — Industry Findings (driving harness redesign)
date: 2026-05-29
tags: [research, context-engineering, harness, agentic, design-grounding]
status: findings
related:
  - "[[2026-05-29-harness-perf-cross-tier-campaign]]"
  - "[[2026-05-29-e2e-perf-bottleneck-findings]]"
  - "[[improvement-2026-05-29]]"
---

# Agentic Context-Engineering — Industry Findings

External research gathered to ground the harness perf/consistency redesign in
cutting-edge agentic-engineering practice (user directive 2026-05-29). Primary
source: Anthropic's "Effective context engineering for AI agents" (Sept 29 2025)
+ Letta/MemGPT, Arize, JetBrains Research, recent arXiv.

## The canonical model (synthesis)

Three rules the field converges on for tool-result/observation handling:

1. **Recent observations: inline + full.** The data the agent needs for the
   CURRENT synthesis step belongs in context, in full. Do not force retrieval
   of data the agent just fetched.
2. **Old observations: CLEAR / COMPACT.** Anthropic: *"One of the safest,
   lightest forms of compaction is tool result clearing"* — "once a tool has
   executed deep in message history, the agent doesn't need to revisit raw
   outputs repeatedly." MemGPT/Letta call this **observation masking**: compress
   the environment-observation channel while preserving action + reasoning
   history ("a typical agent's turn heavily skews toward observation").
3. **Retrieval (recall) fires ONLY for data NOT in context.** Anthropic's
   "just-in-time" principle: maintain lightweight identifiers (file paths,
   stored queries), load on demand via tools. This is for data NOT yet loaded
   (large external stores) — explicitly NOT for re-fetching data already inline.
   Arize: "give the agent retrieval as a tool… fires at the right moment" — i.e.
   when context is actually missing.

**Tradeoff (Anthropic):** "Runtime exploration is slower than retrieving
pre-computed data." → recall has a real cost; only pay it when the data isn't
already present. Hybrid: "retrieve some data up front for speed, pursue further
autonomous exploration."

## How this DRIVES our design decisions

Maps the canonical model onto the campaign's two diagnosed defects (see
[[2026-05-29-harness-perf-cross-tier-campaign]] D1 + local baseline):

| Canonical rule | Our current behavior | Verdict | Fix |
|---|---|---|---|
| Recent obs inline-full | ≤4000 chars inline in `state.messages` (conversation-assembly G-4) | ✅ aligned | keep |
| Old obs cleared/compacted | Full history re-sent every iteration → local token-bloat (qwen3.5 T2 no-recall = 12K tok vs gpt-4o-mini 5.8K, 2×) | ❌ violates rule 2 | observation masking / tool-result clearing on OLD turns |
| Recall only for not-in-context | `hasStoredResults` advertises recall even when data is inline → stochastic redundant recall (D1) | ❌ violates rule 3 | gate recall advertisement on actually-cleared/truncated, not "stored" |

**Unification:** the advisor warned D1 (mid/frontier redundant-recall) and local
loop-economics might be two independent problems. The research shows they are
**two facets of ONE canonical context model** the harness half-implements:
- It does rule 1 (recent inline). ✓
- It skips rule 2 (never clears old observations → re-send bloat). ✗
- It mis-applies rule 3 (advertises recall for in-context data). ✗

A single coherent redesign — **"recent inline-full · old cleared · recall only
for absent data"** — addresses both the frontier redundant-recall AND the local
token-bloat. That is the canonical solution to build and prove.

## Loop / stall detection (secondary defect — entropy non-discriminating)

Our entropy signal is flat (~0.15) on normal runs → stall-detect fires false
"stuck" then self-suppresses. Research consensus:
- **Structural repetition detection** ("boredom detection"): track last N actions,
  flag same-tool + same-params + same-output-type — NOT a single scalar like
  entropy. Multiple signals beat one metric.
- **Extrinsic stop rules** enforced outside the model (progress detection +
  verifier). We have a verifier ✓; the entropy-based stall path is the weak link.
- Our `loop-detector` (maxConsecutiveThoughts=3) IS structural — keep it; the
  entropy stall-detect is the candidate to demote/replace.

## Anti-patterns the field names (cross-check against our harness)

- **Implicit state in the context window** (MemU 2026: ~2%/step retention loss;
  <60% by step 5). → persist decisions in explicit structures, not "model
  remembers." (We have `state.steps` / scratchpad — OK; watch re-send reliance.)
- **Memory poisoning**: never store model-invented statements unless backed by a
  tool result. (Cross-check MemoryExtractor.)
- **Forcing recall for already-present data** = the D1 anti-pattern, now
  externally corroborated.

## Tier-aware calibration — handling ALL tiers with precision (deep pass)

User directive: the harness must handle frontier AND local tiers flawlessly,
tailoring context **style, length, and verbosity to the model**. Research basis:

### Finding 1 — effective context ≪ advertised window (calibrate to effective)
- **RULER benchmark:** models claiming 32K maintain quality only to ~4K on
  complex (non-needle) tasks; "almost all exhibit large degradation as sequence
  length increases." GPT-4 (best) still degrades 15.4 pts 4K→128K. Small/local
  models degrade far earlier/harder.
- **Context rot (Chroma, 18 models):** EVERY model gets worse as input grows,
  *even below the window limit* — "more tokens in → worse out." Three mechanisms:
  lost-in-the-middle (30%+ mid-context accuracy drop), attention dilution,
  distractor interference.
- **Implication:** budget the harness's context to each tier's EFFECTIVE context,
  not its advertised window. **Our qwen3.5 2× token-bloat (12K vs 5.8K) is a
  CORRECTNESS risk, not just cost** — it pushes a weak model into context-rot
  territory. Local T5 composite 71% (vs frontier 100%) is consistent with rot.

### Finding 2 — weaker models need LESS verbosity, not more (invert current branch)
- OpenDev (arXiv 2603.05344): "Provider-specific conditional sections inject only
  relevant instructions based on detected model capabilities, **avoiding
  unnecessary verbosity for weaker models**." Smallest-high-signal-token set.
- Claude Opus 4.8 + Adaptive Length Penalty (arXiv 2506.05256): calibrate
  generation length to task complexity / per-prompt solve-rate; models
  over-generate on easy tasks.
- **Cross-check our harness:** `context-engine.ts:188` already branches
  large/frontier vs local/mid — but BOTH branches ADD a recall rule, and the
  local branch isn't demonstrably terser. Research says weak tier should get
  FEWER rules + tighter rendering, scaled to effective context.

### Finding 3 — staged compaction, scaled per tier (rule 2, operationalized)
- OpenDev treats "context pressure as the central design constraint": Phase-0
  staged compaction progressively summarizes OLDER observations before new LLM
  calls; "per-tool-type summarization" + "large-output offloading" rather than
  uniform truncation. For small-context models: compact MORE aggressively,
  restrict subagent spawning, graceful degradation (disable optional thinking/
  VLM phases rather than fail).
- **Maps to:** local tier needs aggressive old-observation clearing (our rule-2
  gap is most acute on local — it can least afford history bloat).

### Finding 4 — position matters for local (recency placement)
- Lost-in-the-middle: keep synthesis-critical data at the END of context for
  weak models. Tool results + the actual task should be recency-placed on local.

### Tier-calibration design model (extends the 3-rule model with a TIER axis)
| Knob | Frontier | Mid | Local | Source |
|---|---|---|---|---|
| Context budget | high (but still < window) | medium | **tight, ≈ effective ctx** | RULER, context-rot |
| Prompt verbosity / # rules | richer OK | medium | **terse, high-signal only** | OpenDev, ALP |
| Tool-result render budget | larger inline cap | medium | **small; recency-placed** | context-rot, LiM |
| Old-observation clearing | as needed | moderate | **aggressive (rule 2)** | OpenDev staged compaction |
| Recall advertisement | only when truncated | only when truncated | only when truncated | Anthropic JIT (rule 3) |
| Reasoning/thinking budget | full | moderate | **capped; graceful-degrade** | OpenDev graceful degradation |

**The harness already HAS a calibration substrate** (`context-profile.ts`,
`withCalibration`, `optimalToolResultChars`, `toolResultPreviewItems`,
`context-engine.ts` tier branch). The redesign makes those knobs
**effective-context-driven + verbosity-reducing on weak tiers**, not ad-hoc
defaults tuned once for one model. This is how adaptive tiers "compensate" —
precisely the user's ask.

## Sources
- [Anthropic — Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [OpenDev — Building AI Coding Agents for the Terminal: Harness + Context Engineering (arXiv 2603.05344)](https://arxiv.org/html/2603.05344v2)
- [RULER — What's the Real Context Size of Your Long-Context LLMs? (arXiv 2404.06654)](https://arxiv.org/pdf/2404.06654)
- [Chroma — Context Rot (via Morph guide)](https://www.morphllm.com/context-rot)
- [Context Length Alone Hurts LLM Performance Despite Perfect Retrieval (arXiv 2510.05381)](https://arxiv.org/html/2510.05381v1)
- [Just Enough Thinking — Adaptive Length Penalties RL (arXiv 2506.05256)](https://arxiv.org/pdf/2506.05256)
- [LLMLingua-2 — Task-Agnostic Prompt Compression (arXiv 2403.12968)](https://arxiv.org/pdf/2403.12968)
- [Arize — Context management in agent harnesses](https://arize.com/blog/context-management-in-agent-harnesses/)
- [Letta — Memory Blocks](https://www.letta.com/blog/memory-blocks)
- [MemGPT — Towards LLMs as Operating Systems](https://www.leoniemonigatti.com/papers/memgpt.html)
- [JetBrains Research — Smarter Context Management for LLM Agents (Dec 2025)](https://blog.jetbrains.com/research/2025/12/efficient-context-management/)
- [Active Context Compression (arXiv 2601.07190)](https://arxiv.org/html/2601.07190v1)
- [Atlan — Agent Harness Failures: 13 Anti-Patterns](https://atlan.com/know/agent-harness-failures-anti-patterns/)
