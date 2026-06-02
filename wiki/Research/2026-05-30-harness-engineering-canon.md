---
title: Harness Engineering Canon (2025–2026) — convergent agentic design patterns
date: 2026-05-30
type: research
tags: [agentic, harness, context-engineering, verification, research]
related:
  - "[[2026-05-29-agentic-context-engineering-findings]]"
  - "[[2026-05-30-reactive-agents-alignment-gap]]"
---

# Harness Engineering Canon (2025–2026)

Convergent, state-of-the-art patterns from primary sources, for aligning the
reactive-agents harness. Declarative; confidence-scored; dated.

## 1. Outcome / state-grounded verification (THE anchor)

- **Verify world-STATE, not transcript or LLM-judge.** τ-bench/τ²-bench confirm
  task success by comparing the final **database state** to an annotated goal
  state — e.g. order status actually = "cancelled" — not that the right API was
  named. **high** (Source: Sierra τ-bench arXiv 2406.12045 / τ²-bench 2506.07982).
- **Proxy state = a minimal set of observable post-conditions** that reliably
  indicate success (calendar task → "event created with correct date/time/
  attendees"), checked against predefined criteria; completion approved only when
  post-conditions hold. State-based beats LLM-judge: cannot hallucinate success,
  cheaper, deterministic, grounds truth. **high** (Source: Proxy State-Based
  Evaluation, arXiv 2602.16246).
- **Reliability is a `pass^k` property, not `pass@1`.** A 90% pass@1 agent drops
  to **57% at k=8** (all-8-succeed). Single-run success hides inconsistency.
  **high** (Source: τ-bench).
- **DSPy Assertions** = programmatic boolean constraints on LM output: **hard
  assertions** halt after max retries; **soft suggestions** continue; on failure
  the pipeline **backtracks + retries with the error injected** into the prompt
  for self-refinement. **high** (Source: DSPy Assertions, arXiv 2312.13382).
- **Evaluator-optimizer** is the canonical loop: a generator LLM + a separate
  evaluator in a loop — "particularly effective when there are clear evaluation
  criteria and iterative refinement provides measurable value." **high**
  (Source: Anthropic, Building Effective Agents, 2024).
- **SWE-bench / SWE-agent**: success = tests pass; interface design (the ACI)
  strongly affects performance — agents are a new class of user needing
  purpose-built interfaces. **high** (Source: SWE-agent, arXiv 2405.15793).

## 2. Context engineering

- **Core tenet: the smallest set of high-signal tokens that maximize the
  likelihood of the desired outcome.** Context is a finite resource with
  diminishing returns. **high** (Source: Anthropic, Effective Context Engineering
  for AI Agents, 2025-09-29).
- **Context rot** is real and gradual: as tokens grow, recall + long-range
  reasoning degrade (n² attention, finite attention budget) — a performance
  gradient, not a cliff. **high** (Anthropic, ibid; corroborates Chroma Context
  Rot, RULER from [[2026-05-29-agentic-context-engineering-findings]]).
- **The "dumb zone": the middle 40–60% of a large window degrades recall**;
  filling past ~40% yields diminishing returns. Own your context window.
  **medium** (Source: 12-Factor Agents, humanlayer, factor 3).
- **Tool-result clearing** — drop the bulky `tool_result` payload deep in history
  but keep the `tool_use` record so the model knows the call happened; the safest
  lightest-touch compaction. **high** (Anthropic, ibid).
- **Compaction** — near the window limit, summarize the conversation
  high-fidelity and reinitiate from the summary. **high** (Anthropic, ibid).
- **Just-in-time retrieval** — hold lightweight identifiers (paths/URLs/queries),
  load full data on demand via tools; don't front-load corpuses. **high**
  (Anthropic, ibid; Claude Code uses this for large-DB analysis).
- **Reversible compression** — when dropping content, keep the pointer (drop web
  page body, keep URL; drop doc text, keep file path) so nothing is irreversibly
  lost. **high** (Source: Manus, Context Engineering Lessons, 2025-07).
- **Recitation** — continuously rewrite a `todo.md` so the global plan re-enters
  the **recency** span each turn, countering lost-in-the-middle over ~50-call
  tasks. **high** (Manus, ibid).
- **Recency placement** beats middle placement for goal/critical data. **high**
  (Manus + 12-factor + Context Rot).

## 3. Tool orchestration

- **Mask, don't remove.** Dynamically adding/removing tools invalidates the
  KV-cache (tool defs sit near the front) AND leaves stale tool refs in history
  that confuse the model. Manus instead keeps all tools resident and uses a
  **context-aware state machine + logit masking** (constrain to a subset via
  response prefill; consistent tool-name prefixes like `browser_*`/`shell_*`
  enable prefix masking). **high** (Manus, ibid). ⚠️ Directly challenges
  RA's lazy-disclosure (dynamic prune) — see [[2026-05-30-reactive-agents-alignment-gap]].
- **KV-cache stability is the #1 production metric** — stable prompt prefix,
  append-only context, deterministic JSON, no second-precision timestamps;
  cached vs uncached = 10× cost on Sonnet. **high** (Manus, ibid).
- **Minimal viable tool set, no overlap.** "If a human engineer can't say which
  tool to use, the agent can't either." Tools must be self-contained, robust to
  error, extremely clear. **high** (Anthropic, ibid).
- **Tools are structured output**, not magic — the model emits JSON matching a
  schema; validate it. **high** (12-Factor Agents, factor 4).
- **Preserve errors in context** — leaving failed actions + stack traces shifts
  the model's prior away from repeating them; error recovery is a core marker of
  agentic behavior (and under-benchmarked). **high** (Manus, ibid).
- **Avoid few-shot ruts** — uniform repeated examples cause drift/overgeneralize;
  inject small structured variation. **medium** (Manus, ibid).

## 4. Agentic loop & strategy

- **Prefer the simplest pattern; workflows over agents when steps are
  predictable.** Five patterns: prompt-chaining, routing, parallelization,
  orchestrator-worker, evaluator-optimizer. Add agentic autonomy only when the
  task needs it. **high** (Anthropic, Building Effective Agents, 2024).
- **Stateless reducer**: model the agent as a pure function `f(events) →
  next_action`, reconstructing context from an event log → deterministic test /
  replay / debug. **high** (12-Factor Agents, factor 12). Aligns with RA's
  two-record (messages vs steps) model.
- **Reflexion reflection is driven by an EXTERNAL signal** (env reward/test),
  not pure self-judgment of output text. **high** (Reflexion, Shinn 2023).

## 5. Memory & externalized context

- **File system as the ultimate context** — unlimited, persistent, agent-
  operable; externalize memory beyond the window with reversible compression.
  **high** (Manus, ibid).
- **Structured note-taking persisted outside the window**, re-entering later
  (Claude Code to-do lists; Claude-plays-Pokémon maps/objectives over thousands
  of steps; Anthropic memory tool, public beta). **high** (Anthropic, ibid).
- Tiered memory (working/episodic/semantic/procedural) — MemGPT/Letta. **high**
  (from [[2026-05-29-agentic-context-engineering-findings]]).

## 6. Sub-agent delegation & multi-agent

- **Sub-agents isolate context**: a worker explores in a clean window and returns
  a **condensed 1,000–2,000-token summary** to the coordinator; separates
  detailed search from synthesis. **high** (Anthropic, Context Engineering, 2025).
- **Multi-agent wins on breadth/parallel-read** — orchestrator-worker beat
  single-agent by **90.2%** on research eval; **token usage explains ~80% of
  performance variance**; multi-agent uses ~15× tokens. **high** (Anthropic,
  How we built our multi-agent research system, 2025).
- **TENSION (resolved by task type):** Cognition "Don't Build Multi-Agents" —
  parallel writers are fragile (dispersed decisions, unshared context); keep a
  **single-threaded linear agent** so reasoning stays centralized. Early-2026
  reconciliation: multi-agent works **when writes stay single-threaded and extra
  agents add intelligence, not actions.** **high** (Source: Cognition, Don't
  Build Multi-Agents, 2025; Multi-Agents Working, 2026). → delegate read/breadth,
  keep writes/interdependent work single-threaded.

## 7. Named anti-patterns (cross-check targets)

- Judging completion by **prose/self-report or LLM-judge** instead of state.
- **Dynamically mutating the tool set** mid-run (cache + stale-ref damage) —
  mask instead.
- **Front-loading** corpuses/all-tools instead of just-in-time.
- **Over-stuffing** context past the dumb zone (>40%).
- **Hiding errors** from context.
- **Few-shot uniformity** ruts.
- **Multi-agent for interdependent/write-heavy** tasks.
- **Keyword-brittle routing** (RA-specific; canon says route on task structure /
  let a capable model direct, not regex keywords).

## Sources
- Anthropic — Effective Context Engineering for AI Agents (2025-09-29)
- Anthropic — Building Effective Agents (2024); Multi-Agent Research System (2025)
- Manus — Context Engineering for AI Agents: Lessons from Building Manus (2025-07)
- Cognition — Don't Build Multi-Agents (2025); Multi-Agents Working (2026)
- Sierra — τ-bench (arXiv 2406.12045); τ²-bench (2506.07982)
- Proxy State-Based Evaluation for Multi-turn Tool-Calling Agents (arXiv 2602.16246)
- DSPy Assertions (arXiv 2312.13382); SWE-agent (arXiv 2405.15793)
- 12-Factor Agents — humanlayer
- Reflexion (Shinn et al. 2023); MemGPT/Letta
