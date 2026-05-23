---
type: pilot-charter
status: active
created: 2026-05-23
expires: 2026-06-15
related:
  - "[[2026-05-23-team-ownership-dev-contract-pilot]]"
  - "[[2026-05-18-agentic-team-ownership-concepts]]"
---

# Pilot Charter — Team-Ownership Dev Contract

**Window:** 2026-05-23 → 2026-06-15 (3 weeks, hard expiry).
**Scope:** Edits across all packages listed in the forcing-function table below, plus cross-cutting tasks (probes, ablations, releases, debriefs).
**Hypothesis:** A team of bounded wardens — each with a domain primer + MissionBrief input + UpwardReport output — produces measurably better outcomes than main-thread direct edits across the codebase.

## Warden roster (pilot set)

### Domain wardens (own a package slice; refuse cross-boundary edits)

| Warden | Authority manifest |
|---|---|
| `kernel-warden` | `packages/reasoning/src/kernel/**` |
| `provider-warden` | `packages/llm-provider/**` |
| `tools-warden` | `packages/tools/**` |
| `memory-warden` | `packages/memory/**` |
| `runtime-warden` | `packages/runtime/**` |
| `compose-warden` | `packages/compose/**` |

### Cross-cutting specialists (do NOT patch framework code — surface findings, dispatch domain wardens)

| Warden | Role |
|---|---|
| `harness-warden` | Runs probes, owns `wiki/Research/Harness-Reports/**`, returns rax-diagnose findings |
| `ablation-warden` | Runs cross-tier matrix, enforces lift rule, holds veto over default-on changes |
| `release-warden` | Pre-tag audit, version-drift gate, never `npm publish` manually |
| `debrief-scribe` | Writes AAR to `wiki/Research/Debriefs/**` from UpwardReport + git diff |

All ten share the `MissionBrief` input contract + `UpwardReport` output contract — see `.agents/skills/{mission-brief,upward-report}/SKILL.md`.

## Forcing function

Between 2026-05-23 and 2026-06-15, any edit whose primary scope matches a warden's authority manifest MUST be routed through that warden via `Agent` dispatch. Main-thread direct edits violate the contract and disqualify the task from pilot data. Single exception: hot-fix to red CI on `main`, logged with `bypass-reason` in `log.md`.

## Lift threshold (canonicalize at Phase 2 — AND-of, applied to aggregate)

- ≥ 10 pilot tasks logged across all wardens combined
- First-attempt completion rate ≥ baseline + 3pp
- Token overhead ≤ 15%
- Avg re-spawn count ≤ 1.5
- ≥ 1 documented regression-catch attributable to a warden's domain primer

## Kill threshold (REWORK + revert if ANY of)

- First-attempt completion rate < baseline − 3pp
- Token overhead > 30%
- Avg re-spawn count > 2.5
- < 10 pilot tasks logged by 2026-06-15
- Tyler declares net friction in `log.md` summary

## Default on 2026-06-15

Inconclusive → kill. Affirmative evidence required for canonicalization. Mirrors M3 REWORK precedent. Evaluator: `ablation-warden` applies its own lift rule to the pilot as a whole — first real assignment.

## Out of scope (do not measure)

- Multi-agent runtime contract changes — separate concern, see [[2026-05-18-agentic-team-ownership-concepts]]
- New warden roles beyond the pilot set (Phase 2 candidates, ablation-gated)
- LLM re-verify of warden output — recreates M3 verify-retry failure mode (`verifier.ts:217-222`)

## Evaluation date

2026-06-15. Write evaluation entry to `log.md` summary section. Decide canonicalize / revert. No extensions.
