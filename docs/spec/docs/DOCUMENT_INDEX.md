# Document Index — `docs/spec/docs/`

> **Last updated:** 2026-05-04 (consolidated naming + archival cleanup; refactor/overhaul).
> **Purpose:** Map every document in this directory to its purpose. Ranked from "read first" to "reference when needed."
>
> **Authority:** Uniform numbering `NN-NAME.md` (00–07). Single source of truth for agent guidance per AGENTS.md.

---

## Canonical documents (read in this order)

| # | File | Purpose |
|---|---|---|
| 0 | `00-VISION.md` | What we're building toward — 4 pillars (Reliability, Control, Security, Performance). Stable anchor. |
| 1 | `START_HERE_AI_AGENTS.md` | Agent session-start entry point — points at `04-PROJECT-STATE.md` |
| 2 | `04-PROJECT-STATE.md` | **READ FIRST.** Current empirical state of the project; updated per session start |
| 3 | `07-ROADMAP-v1.0.md` | **SEQUENCING AUTHORITY** — v0.10.0 → v1.0, 8 phases, validation gates, integrated architecture |
| 4 | `06-AUDIT-v0.10.0.md` | v0.10.0 release quality gate — 28 packages + 13 mechanisms + 44-item FIX backlog (v0.10.0 only) |
| 5 | `05-DESIGN-NORTH-STAR.md` | v3.0 architecture reference — 10 capabilities + cognitive kernel + ports (Phase 2+ target) |
| 6 | `01-RESEARCH-DISCIPLINE.md` | 12 rules for every harness change; methodology contract |
| 7 | `02-FAILURE-MODES.md` | Living catalog of harness failure modes (FM-A1, FM-B2, etc.) |
| 8 | `03-IMPROVEMENT-PIPELINE.md` | Operational rhythm — DISCOVERY → DEPRECATE flywheel |

**Authority Hierarchy:**
- `07-ROADMAP-v1.0.md` > `06-AUDIT-v0.10.0.md` > `04-PROJECT-STATE.md` > `01-RESEARCH-DISCIPLINE.md`
- If docs conflict: amend lower-authority doc, never silent drift.

**That's the entire active set.** If a question isn't answered above, the answer either (a) lives in code (read it), (b) lives in `apps/docs/src/content/docs/` (Starlight), or (c) is in `docs/superpowers/plans/archive/` (historical).

---

## Subdirectories

- `explorations/` — speculative, in-flight design exploration. Not authoritative; don't cite as architecture.
- `_archive/` — pre-overhaul docs (March-era and earlier). Preserved for traceability. **Do not treat as authoritative.** Each archived file has a banner noting its archive date.

---

## What's NOT in this directory

- Build commands, package matrix, quality gates → `AGENTS.md` (root)
- Public framework usage / quickstart → `README.md` (root)
- API and behavior reference → `apps/docs/src/content/docs/`
- Release history → `CHANGELOG.md` (root)
- Roadmap → `ROADMAP.md` (root)

---

*If you add a new spec doc, update this index. Don't grow the canonical set lightly — every new file is one more thing for future agents to keep in their head.*
