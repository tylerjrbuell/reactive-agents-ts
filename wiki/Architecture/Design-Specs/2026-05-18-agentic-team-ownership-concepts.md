---
type: design-concept
status: future
created: 2026-05-18
tags: [multi-agent, agentic-teams, delegation, ownership, future-work]
related:
  - "[[05-DESIGN-NORTH-STAR]]"
  - "[[02-FAILURE-MODES]]"
scope: multi-agent runtime only — single-agent kernel already serves these (KEEP, no action)
---

# Agentic Team Ownership — Concepts for Later

> **Why this doc exists:** A research pass mapped *Extreme Ownership* (Willink/Babin) onto the framework. Conclusion after pruning: the doctrine framing belongs in **development discipline**, which is *already* the project canon (Research Discipline 12 rules, Pruning Principle §9, one-concern-per-commit, debrief ritual, ablation gates — no new doc or system needed). The **only** part with lasting *runtime* value is a set of concrete gaps in the multi-agent spine. This doc preserves those for when agentic teams are built (v0.12+). It is **not an active plan** and carries **no doctrine vocabulary into code**.

## The one finding worth keeping

The multi-agent spine today is a **fan-out executor, not a command structure**: it dispatches sub-agents and contains their failure, but propagates no mission intent, enforces no authority, reports nothing upward, and never owns a delegated failure. That is the gap between a work crew and a team. Every gap below is **a missing field on an existing contract, not a missing subsystem** — close them by extending shared seams, never by adding packages, never with an LLM verification loop.

## The four real gaps (plain names, evidence anchors)

| Gap | What's missing | Evidence anchor | Reuse, don't rebuild |
|-----|----------------|-----------------|----------------------|
| **Own delegated failure** | Sub-agent `{success:false}` re-enters parent as ordinary failed-tool observation; no re-plan/escalate; guardrail/killswitch fire is abort-only (zero `catchTag` recovery) | `act.ts:641`; `orchestration-service.ts:93` (retry machinery disconnected from spawn path) | Deterministic `catchTag` owner → existing arbitrator/OrchestrationService. **Never** parent-side LLM re-verify |
| **Upward report** | `SubAgentResult = {success, summary}` only — no confidence/blockers/escalation. A2A already has the richer vocabulary and discards it | `agent-tool-adapter.ts:136`; A2A `TaskState` at `a2a/types.ts:112` | Mirror A2A `TaskState` into optional `SubAgentResult` fields (backward-compatible) |
| **Authority enforcement** | `identity.Delegation` is scoped/attenuating/time-boxed/revocable/audited — but kernel act/ **never calls `authorize()`**; boundary declared, never enforced | `permission-manager.ts:84`; zero `authorize()` calls in `kernel/capabilities/act/` | Reuse `identity.Delegation` (no new authority type); one enforcement seam → existing `InteractionManager.approvalGate()` on deny |
| **Mission intent to sub-agents** | Sub-agents get generic directive + data, no end-state/why/constraints. `TaskIntent` has no structured intent | `agent-tool-adapter.ts:56`; `task-intent.ts:21` | Extend `TaskIntent`/`ParentContext` via existing `buildParentContextPrefix`. **Empirically unproven — gate before default-on** |

Shared seam for all four: `createSubAgentExecutor` + `buildSubAgentSystemPrompt` (`helpers.ts:136`), surfaced via the **existing** `.withAgentTool` config + `spawn-agent` args — **no new builder method**.

## Three conflict warnings (load-bearing — do not re-discover the hard way)

1. **Own-failure must be deterministic, never LLM re-verify.** A parent-side LLM quality-gate over delegated output recreates the double-rejection failure deliberately removed at `verifier.ts:217-222` and the M3 verify-retry loop the project killed (REWORK verdict). Owner = deterministic FSM on the structured upward report.
2. **Mission-intent propagation is an untested assumption.** "A frontier model loses the why from a plain task string" is unproven. Any intent plumbing must be ablation-gated with a pre-stated rule (≥2 models, ≥3pp lift & ≤15% token overhead → default-on; else opt-in; else remove — the M3 precedent) before going default-on.
3. **No new contract/AAR types.** `BehavioralContract`/`AgentContract` already overlap; `synthesizeDebrief()` AAR already exists with the cross-session loop closed. Any team-ownership work routes through these — net type count must not rise.

## Deterministic recovery FSM (for the "own delegated failure" gap)

| Upward report state | Owner action (no LLM call) |
|---|---|
| `failed`, `blockers≠∅`, retries remaining | Re-dispatch with blockers injected |
| `failed`, retries exhausted **OR** `escalationRequired` | Escalate via existing `approvalGate()` |
| `denied-by-authority` | Escalate (cannot re-plan around an authority bound) |
| `completed`, `confidence < floor` | Accept-with-disclosure (annotated, not silent pass-through) |

## Prerequisite, independent of this concept (worth doing anyway)

These stand on their own merit (debt/security), not gated on agentic-teams work; eligible any cycle:
- Collapse `AgentContract` → `BehavioralContract` (deprecated alias; both publicly exported from `@reactive-agents/guardrails` v0.10.6 so it is a `minor` + alias, not a hard rename).
- Wire the severed `ExperienceSummary` loop — `context-manager.ts:271` hardcodes `experienceSummary: undefined` with a literal TODO; consumer already wired at `adapter.ts:214`.
- Wire `IdentityService.authorize()` into the kernel act path (declared security control currently doing nothing).
- Fix inert `confidenceFloor` killswitch (registers on a phase that never fires).

## Extreme Ownership as development discipline (no runtime work)

Already project canon — named here only so the lens is explicit:
- *Check the ego* → ablate even research-backed mechanisms (M3 precedent). → [[01-RESEARCH-DISCIPLINE]]
- *Simple* → Pruning Principle. → North Star §9
- *Prioritize & execute* → one concern per commit, one mechanism per spike (Rule 7).
- *After-action review* → debrief ritual. → `wiki/Research/Debriefs/`
- *Discipline = freedom* → CODING_STANDARDS + quality gates.

Possible single gap to make explicit (optional): a debrief rule that the harness change **owns its regression** — no "model was flaky" excuses. No system, just a sentence in the debrief template.

## Companion sources (for the eventual agentic-teams build)

*The Dichotomy of Leadership* (authority-bound tuning) · *Team of Teams*, McChrystal (shared-awareness at scale) · *Turn the Ship Around!*, Marquet (the "I intend to…" upward-report grammar) · USMC *Warfighting* MCDP-1 (intent schema: end-state, purpose, key tasks).

---
**Status:** future concept, not scheduled. No code, no active plan, no doctrine vocabulary in the codebase. Pick up when agentic teams are on the roadmap (v0.12+).
