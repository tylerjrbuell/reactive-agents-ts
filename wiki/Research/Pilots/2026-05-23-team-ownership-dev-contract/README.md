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
**Scope:** Edits whose primary scope is `packages/reasoning/src/kernel/**`.
**Hypothesis:** A bounded `kernel-warden` agent with a domain primer + MissionBrief input + UpwardReport output produces measurably better outcomes than main-thread direct edits.

## Success / kill criteria

See [[2026-05-23-team-ownership-dev-contract-pilot#Pre-stated Success / Kill Criteria]]. Reproduced here so the charter is self-sufficient.

### Forcing function

Between 2026-05-23 and 2026-06-15, any edit whose primary scope is `packages/reasoning/src/kernel/**` MUST be routed through `kernel-warden` via Agent dispatch. Main-thread direct edits during the pilot window violate the contract and disqualify the task from pilot data. Single exception: hot-fix to red CI on `main`, logged with `bypass-reason` in `log.md`.

### Lift threshold (canonicalize at Phase 2 if AND-of)

- First-attempt completion rate ≥ baseline + 3pp
- Token overhead ≤ 15%
- Avg re-spawn count ≤ 1.5
- ≥ 1 documented regression-catch attributable to warden domain primer

### Kill threshold (REWORK if ANY of)

- First-attempt completion rate < baseline − 3pp
- Token overhead > 30%
- Avg re-spawn count > 2.5
- < 10 pilot tasks logged by 2026-06-15
- Tyler declares net friction in `log.md` summary entry

### Default on 2026-06-15

Inconclusive → kill. Affirmative evidence required for canonicalization. Mirrors M3 REWORK precedent.

## Out of scope (do not measure)

- Performance on non-kernel packages
- Multiple wardens (Phase 2 only)
- Runtime multi-agent execution (separate concern, see [[2026-05-18-agentic-team-ownership-concepts]])

## Evaluation date

2026-06-15. Write evaluation entry to `log.md` summary section. Decide canonicalize / revert. No extensions.
