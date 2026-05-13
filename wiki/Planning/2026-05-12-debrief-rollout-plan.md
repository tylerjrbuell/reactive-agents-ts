---
type: planning-note
date: 2026-05-12
status: planning
scope: roadmap-alignment
related:
  - "[[Planning/Implementation-Plans/2026-05-12-decision-rationale-traceability]]"
  - "[[Planning/Implementation-Plans/2026-05-06-v0.11-launch-readiness]]"
---

# Debrief Command Rollout — Roadmap Positioning

## Context

User inquiry about decision traceability surfaced a key differentiator: **the ability to read back "why" from agent traces**. Reactive Agents already captures this data; the gap is exposing it through a readable debrief format.

## Opportunity

The debrief command (`rax:diagnose debrief <runId>`) addresses a real problem:
- Current: `rax:replay` streams raw JSONL (machine-readable, human-hostile)
- Proposed: `rax:diagnose debrief` renders markdown timeline (human-readable, auditable)
- Use case: post-mortem analysis, demo walkthrough, safety audit, model comparison

## Timeline Fit

**Decision traceability plan** (2026-05-12) stages implementation:

| Phase | Tasks | Duration | Gate |
|-------|-------|----------|------|
| v1 (immediate) | Tasks 1,2,3,4,6,9 | ~2 weeks | Can start after M3 ablation |
| v1.5 (Phase D) | Tasks 5,7,8,10,11 | ~2 weeks | Deferred until Compose API Wave A lands |

**Task 9 (debrief command) is in v1 → can ship alongside Compose API or independently.**

## Positioning for v0.11 Launch

### Option A: Ship with v0.11 (May 29 target)

**Pro:**
- Debrief is a unique capability vs competitors
- Makes Cortex Studio "replay" feature more valuable
- Strengthens "every decision explainable" positioning

**Con:**
- Requires Task 1–4 (rationale schema) to be done before Task 9
- Adds 2 weeks to launch if not already in progress

### Option B: Ship as v0.11.1 (early June)

**Pro:**
- Debrief doesn't block core Compose API + launch checklist
- Can focus on v0.11 differentiators (Compose API, skill persistence, playground)
- Rationale schema can mature in parallel

**Con:**
- Misses the "every decision explainable" narrative at launch
- Pushes post-launch announcement to 1–2 weeks later

## Recommendation

**Option A (ship with v0.11) IF:**
- M3 ablation finishes by May 18 (clears the gate)
- Task 1–4 can be done in parallel with Compose API Wave A (different files, zero conflicts)
- Debrief (Task 9) blocks nothing

**Option B (ship as v0.11.1) IF:**
- v0.11 launch date is immovable (May 29)
- Compose API Wave A demand is higher priority

## What to Communicate Externally (Now)

**For the inquiry:** Use the email response at `wiki/Research/Email-Responses/2026-05-12-decision-traceability-inquiry.md` as the starting point. Emphasize:

1. Trace recording is already comprehensive
2. Structured rationale + debrief command are coming
3. This is a core part of "every decision explainable and replayable"

**For roadmap/docs:**
- Link from `ROADMAP.md` → `v0.11 Differentiators` → note debrief as "coming in v0.11"
- Add to `CHANGELOG.md` under "Unreleased" → debrief command (planned)

## Next Steps

1. **M3 ablation gate** (1 day) — completes May 13
2. **Decide ship-with vs ship-after** — May 13 planning session
3. **If ship-with:** Unblock Task 1 (Rationale schema) → parallel-execute with Wave A
4. **If ship-after:** Add to v0.11.1 plan; plan Task 1–4 for early June
5. **Public communication:** Include decision traceability in v0.11 marketing (either "shipping with" or "coming soon")

## Files to Update

- [ ] `ROADMAP.md` — add debrief under v0.11 or v0.11.1 differentiators
- [ ] `CHANGELOG.md` — unreleased section
- [ ] `apps/docs/src/content/docs/` — add `decision-tracing.mdx` (included in Task 12 of plan)
- [ ] `AGENTS.md` — add "Decision Tracing" subsection (included in Task 12)

---

**Owner:** Tyler (planning/rollout decision)  
**Blockers:** M3 ablation (May 13)  
**Target decision:** May 13 EOD
