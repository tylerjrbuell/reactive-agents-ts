---
title: Canonical Agentic Convergence — Implementation Plan
date: 2026-05-30
status: ready
spec: "[[2026-05-30-canonical-agentic-convergence]]"
research:
  - "[[2026-05-30-harness-engineering-canon]]"
  - "[[2026-05-30-reactive-agents-alignment-gap]]"
---

# Canonical Agentic Convergence — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`
> (recommended) or `superpowers:executing-plans` to implement this plan
> phase-by-phase. Each phase is one subagent dispatch. Steps use checkbox (`- [ ]`)
> syntax. **STANDING GATE: no phase is complete on unit-green alone — each ends with
> a cross-tier `pass^k` live run + `rax:diagnose` trace + advisor() before commit.**

**Architecture:** A single mechanical **post-condition set** (derived
deterministically, no LLM) becomes the success authority (state-grounded done),
the progress ledger (recited into recency), and the pulse self-check — built on
the existing composable kernel + two-record model. Each workstream wires existing
systems and is proven on real models cross-tier before it lands.

**Tech Stack:** TypeScript (strict), Effect-TS, Bun 1.3.10, turbo, bun:test,
`@reactive-agents/trace` + `rax:diagnose`.

---

## Goal
Bring reactive-agents' agentic core to a converged, canonical design so agents —
**including local models** — complete complex multi-step, multi-tool tasks with
accuracy, **consistency** (`pass^k`), efficient tool use, progress comprehension,
and memory. Built on a single mechanical **post-condition spine**.

## Context for Implementers (read first — you have zero project context)

**What RA is:** TypeScript monorepo (~35 packages), Effect-TS, Bun, turbo. A
composable reasoning kernel runs agent loops; strategies (reactive, adaptive,
reflexion, plan-execute, tree-of-thought, direct, code-action) drive it.

**Two-record model (critical):** `state.messages[]` = what the LLM sees (provider
thread); `state.steps[]` = what systems observe (entropy, metrics, ledger). The
tool-call **ledger** lives in `state.steps` (observation steps carry
`metadata.observationResult` + tool name + success).

**Kernel layout:** `packages/reasoning/src/kernel/` — capabilities/{act,attend,
comprehend,decide,reason,reflect,sense,verify}, loop/{runner,react-kernel,
run-pass,terminate}, state/{kernel-state}. Strategies: `packages/reasoning/src/
strategies/`. Context: `packages/reasoning/src/context/`. Runtime engine:
`packages/runtime/src/engine/phases/agent-loop/`.

**Why this plan exists (proven this session):**
- Completion is judged on PROSE (`verify/verifier.ts` checks + reflexion
  `isSatisfied`), so spot-test reported `success:true` with no `./commits.md`
  written. State, not prose, must be the success authority. (Canon: τ-bench,
  proxy-state arXiv 2602.16246, DSPy assertions, evaluator-optimizer.)
- Already-landed bricks: `relevantTools` forwarding fix (commit `17cf85f0`),
  reflexion required-tools completion gate "B" (`93f928e0`) — WS-1 generalizes B.
- Variance is high + invisible: single-run probes hid cogito flip-flop +
  gpt-4o-mini env-cratering. Need `pass^k`. (Canon: τ-bench 90%→57% @ k=8.)

**Design doc:** `[[2026-05-30-canonical-agentic-convergence]]`. **Gap analysis:**
`[[2026-05-30-reactive-agents-alignment-gap]]`. **Canon + citations:**
`[[2026-05-30-harness-engineering-canon]]`.

**Standing user directives (NON-NEGOTIABLE):**
1. **Follow the research** — every change cites the canon page.
2. **Live-run verification as we go** — NO phase is done on unit-green alone. Each
   ends with a **cross-tier `pass^k` live run** (N≥3; local cogito:14b + qwen3.5,
   mid gpt-4o-mini, frontier sonnet-4-6) proving that phase's specific gate, plus
   `rax:diagnose` trace evidence, plus an advisor() call before "done", plus a
   commit carrying the live-run numbers.
3. No `Co-Authored-By`. Use RTK for CLI. Clean types (no `any`). Anti-scaffold
   (every unit has a consumer in its own phase). Control-first (overridable).

## Tech Stack
TypeScript (strict), Effect-TS, Bun 1.3.10 (pinned), turbo, bun:test. Tracing:
`@reactive-agents/trace` + `rax:diagnose` CLI. Probe:
`.claude/skills/harness-improvement-loop/scripts/task-quality-gate.ts`.

## Project Structure (where new code lands)
- PostCondition spine → `packages/reasoning/src/kernel/capabilities/verify/`
  (new `post-conditions.ts`, `post-condition-verifier.ts`).
- Derivation → same dir (`derive-conditions.ts`), consumes required-tools + task text.
- Progress recitation → `packages/reasoning/src/context/context-curator.ts`
  (recency section) + `packages/tools/src/skills/pulse.ts` (self-check).
- Probe / `pass^k` → extend `task-quality-gate.ts`.
- Tool-set stability → `packages/reasoning/src/kernel/capabilities/reason/think.ts`
  (the per-iteration prune at ~line 230) + `tool-capabilities.ts`.

## TDD discipline (every code step)
Per `.claude/skills/agent-tdd`: RED test first (file header `// Run: bun test … --timeout 15000`,
`--timeout` on EVERY test, `Effect.flip` for error paths, fresh layer per test).
RED → GREEN → rebuild affected packages (`cd packages/<pkg> && bun run build`) →
phase live-run gate.

---

## Implementation Phases

> Dependency order: **Phase 0 → Phase 1 → Phase 2 → (Phase 3 ∥ Phase 4) → Phase 5**.
> Phases 3 and 4 are independent of each other and subagent-parallelizable once
> Phase 1 lands. Each phase = one focused subagent dispatch.

### Phase 0 — `pass^k` measurement harness (WS-3) — BUILD FIRST
**Goal:** every later phase's live-run gate needs this. Make consistency measurable.

**Steps:**
1. Extend `task-quality-gate.ts`: add `RUNS_PER_TASK` env (default 3); run each
   task N times; report `pass^k` (all-k-succeed), per-item correctness, and a
   `postConditionsMet` column (stub now, wired in Phase 1).
   - **Verify:** `RUNS_PER_TASK=3 TASK_GATE_MODEL=gpt-4o-mini bun .claude/skills/harness-improvement-loop/scripts/task-quality-gate.ts`
   - **Expect:** summary shows `pass^3` per task + a variance line.
2. Add a strict per-item correctness check for T3 (exact top-3-by-comments id match)
   — composite is too lenient (hid cogito T3=34%).
   - **Verify:** T3 reports strict-correct N/3, not just composite.
3. Capture a cross-tier baseline (cogito:14b, qwen3.5, gpt-4o-mini, sonnet-4-6) →
   `wiki/Research/Harness-Reports/passk-baseline-2026-05-30.md`.
   - **Expect:** reproduces this session's variance as explicit numbers
     (cogito flip-flop, gpt-4o-mini env sensitivity).

**Phase complete when:** `pass^k` cross-tier baseline filed; probe emits the
`postConditionsMet` column (stubbed). advisor() + commit with baseline numbers.

### Phase 1 — PostConditionVerifier spine (WS-1) — THE HEADLINE
**Goal:** state-grounded completion as the success authority; generalizes B.

**DBC contracts:**
- `deriveConditions(task: string, requiredTools: string[]): PostCondition[]`
  - pre: none. post: deterministic (same input → same output); NO LLM call;
    conservative (emits a condition only for a clear deliverable signal).
- `verify(conditions: PostCondition[], steps: ReasoningStep[]): { met: PostCondition[]; unmet: PostCondition[] }`
  - pre: `steps` is the run's full ledger. post: pure; `ToolCalled`/`ArtifactProduced`
    judged from the ledger (successful tool call w/ matching arg), NOT raw fs.

**Steps:**
1. RED: `packages/reasoning/tests/kernel/post-conditions.test.ts` — `PostCondition`
   union (`ToolCalled(name)`, `ArtifactProduced(path)`, `OutputContains(pattern)`)
   + `verify(...)` over a synthetic ledger (tool fired → met; not fired → unmet;
   file-write with matching path arg → ArtifactProduced met).
   - **Verify:** `bun test packages/reasoning/tests/kernel/post-conditions.test.ts --timeout 15000` → RED (module missing).
2. GREEN: `verify/post-conditions.ts` (types + `verify`). Ledger check = scan
   `steps` for successful observation of the tool with matching arg. No fs.
3. RED+GREEN: `verify/derive-conditions.ts` — deterministic derivation. Sources in
   precedence: required-tools → `ToolCalled`; literal deliverable path in task
   (`/\b(create|write|save|generate)\b[^.]*?(\.\w+|\bfile\b)[^.]*?(\.?\/[\w./-]+)/i`,
   **high-precision** — only clear "write a file ./X" forms) → `ArtifactProduced('./X')`
   + the writing tool must fire; explicit format → `OutputContains`. If nothing
   derives → empty set (fall back to prose; additive-only).
   - **Verify:** unit — "create a markdown file (./commits.md)" → `[ArtifactProduced('./commits.md'), ToolCalled(<write>)]`; "summarize recursion" → `[]`.
4. Wire as success authority: in the kernel terminal/verify path
   (`verify/verifier.ts` + `loop/terminate.ts`), `status=completed` requires
   `unmet.length === 0` when conditions non-empty; unmet → `pendingGuidance`
   steering ("you still must: write ./commits.md") + continue (bounded). Demote
   prose verdict to a quality signal. Generalize B: reflexion (and other
   strategies' completion) consult `verify(...)` not just `isSatisfied`.
   - **Verify:** existing reflexion B test still green; new test — conditions
     unmet ⇒ `status !== "completed"`.
5. Wire probe `postConditionsMet` (Phase 0 stub) to real verify output.

**Phase complete when (LIVE-RUN GATE):**
- spot-test (cogito + GitHub-MCP): `success:true` is **impossible** without
  `./commits.md` evidenced in the ledger. Run it; confirm honest status.
- Cross-tier `pass^k`: completion-honesty (no false success) ↑; no-required tasks
  still complete (no regression). Trace via `rax:diagnose`. advisor() + commit
  with numbers.

### Phase 2 — Progress recitation + pulse self-check (WS-4, merges into spine)
**Goal:** the agent always knows goal / done / remaining — mechanically, any tier.

**Steps:**
1. RED+GREEN: a renderer `renderProgressLedger(conditions, steps): string` →
   `Goal · Done: [...] · Remaining: [...]` from `verify(...)`.
2. Wire into recency: `context-curator.ts` appends the ledger to the **end** of the
   prompt (recency span) each turn (gated on non-empty conditions).
   - **Verify:** captured prompt (capturing-LLM test, see `reactive-tool-filtering.test.ts`
     pattern) contains the remaining-items line at the tail.
3. Wire `remaining[]` into `packages/tools/src/skills/pulse.ts` so
   `pulse("am I ready?")` returns the mechanical remaining set (self-check before
   final-answer).
   - **Verify:** pulse with unmet conditions returns them; with all met returns ready.

**Phase complete when (LIVE-RUN GATE):** local-tier multi-step task — agent
references remaining steps unprompted; redundant re-calls ↓ vs Phase-1 baseline;
`pass^k` flat-or-up. advisor() + commit.

### Phase 3 — Remove non-canonical extras (WS-5) — parallelizable with Phase 4
**Goal:** smallest high-signal token set; cheap local-token wins.

**Steps:**
1. Ablate `extractObservationFacts` (`act/tool-execution.ts:822`, gated
   `act.ts:143-144`): run local `obsMode=false` vs baseline, `pass^k` + tokens +
   post-condition pass-rate.
   - **Decision rule:** composite/post-conditions hold AND tokens ↓ ~Inc-2 share →
     default it off where data is inline (or gate on actual >4000 truncation).
     If composite DROPS (cogito needs pre-digest) → keep, make cheaper.
2. Land the Inc 1 recall-gate (already built, opt-in `RA_RECALL_GATE=1` in
   `think.ts` + `think-guards.ts` + `recall-overflow-gating.test.ts`): cross-tier
   `pass^k` recall-rate→0 on inline data, >4000 still recalls → flip default-on if
   proven.

**Phase complete when (LIVE-RUN GATE):** local tokens ↓ with `pass^k` +
post-condition pass-rate flat-or-up, cross-tier. advisor() + commit (each sub-change
its own commit).

### Phase 4 — Tool-set stability (WS-2) — ABLATION-GATED, parallelizable w/ Phase 3
**Goal:** stop per-iteration tool churn (KV-cache + the relevantTools-drop class).

**Steps:**
1. Build the comparison: keep current lazy-disclosure (churn) as arm A; arm B =
   stable visible set (compute once at run start, hold across iterations) +
   provider tool_choice/required to constrain instead of re-pruning. Flag-gated
   (`RA_TOOL_STABLE=1`).
2. Ablate cross-tier: `pass^k`, total tokens, tool-error rate (wrong/hallucinated
   tool calls), KV-cache hit proxy.
   - **Decision rule:** arm B ≥ arm A on tool-accuracy AND ≤ tokens → ship B
     default-on; else keep B opt-in. **Do NOT blind-flip** — lazy-disclosure had
     real 2026-04-26 gains.
3. Regardless of arm: collapse the per-iteration tool-context into ONE struct
   passed atomically (kills the "forgot relevantTools" bug class).

**Phase complete when (LIVE-RUN GATE):** ablation verdict with numbers filed to
`wiki/Research/Harness-Reports/`; chosen arm shipped at the proven default. advisor() + commit.

### Phase 5 — Experience reuse / procedural memory (WS-6)
**Goal:** hand local tiers the procedure they can't plan.

**Steps:**
1. On task entry, key episodic/procedural memory on the **post-condition shape**
   (the derived condition set) → recall prior successful action-sequences for
   similar shapes. Wire existing: `packages/memory/**` + skill store +
   ExperienceSummary loop.
2. Feed the recalled sequence as a bounded "procedure hint" (recency-placed,
   token-capped), control-first (overridable/off).

**Phase complete when (LIVE-RUN GATE):** local-tier repeat-task `pass^k` ↑ with the
hint vs without; no frontier regression; tokens within budget. advisor() + commit.

## Testing Strategy
- Per phase: RED unit (bun:test, `--timeout`) → GREEN → rebuild affected packages →
  **cross-tier `pass^k` live run** (the phase gate) → `rax:diagnose` trace → advisor().
- Full `bun test` (reasoning + runtime) green before each commit; net-new failures
  = blocker.
- Substrate: `task-quality-gate.ts` (T1–T5 + `pass^k`) + spot-test GitHub-MCP for
  the side-effect/deliverable path. Frontier (sonnet) = clean control; local
  (cogito/qwen3.5) = the bar.

## Rollback Plan
Each phase is its own commit(s) on `main` (no push until the user says). Revert a
phase = `git revert <sha>`. New mechanisms ship behind env flags
(`RA_RECALL_GATE`, `RA_TOOL_STABLE`, post-condition authority gated until its
live-run gate passes) so default behavior is unchanged until proven — control-first.

## Open Questions
- WS-2 arm B requires per-provider tool_choice/required support — confirm coverage
  across the 6 adapters (Anthropic/OpenAI/Gemini/LiteLLM/Ollama/test) before
  defaulting B on; Ollama/local may lack it → keep B = stable-set-only there.
- `ArtifactProduced` for non-file side-effects (HTTP POST, DB write) — v1 covers
  file/tool-ledger; richer side-effect kinds deferred (designed seam).
- Model-capability floor: phases make failure HONEST; they do not guarantee a
  weak model CAN complete a given task. `pass^k` will quantify the floor per tier.
