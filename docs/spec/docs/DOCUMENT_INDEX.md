# Document Index — `docs/spec/docs/`

> **Last updated:** 2026-04-28 (post-archive pass on `refactor/overhaul`).
> **Purpose:** Map every document in this directory to its purpose. Ranked from "read first" to "reference when needed."

---

## Canonical documents (read in this order)

| # | File | Purpose |
|---|---|---|
| 1 | `START_HERE_AI_AGENTS.md` | Agent session-start entry point — points at `PROJECT-STATE.md` |
| 2 | `PROJECT-STATE.md` | Current empirical state of the project; updated on meaningful state change |
| 3 | `AUDIT-overhaul-2026.md` | **The overhaul plan** — 28 packages + 13 mechanisms + 44-item FIX backlog + W0-W13 |
| 4 | `00-VISION.md` | What we're building toward — 4 pillars (Reliability, Control, Security, Performance) |
| 5 | `15-design-north-star.md` | v3.0 architecture target — 10 capabilities + cognitive kernel + ports |
| 6 | `00-RESEARCH-DISCIPLINE.md` | 12 rules for every harness change |
| 7 | `01-FAILURE-MODES.md` | Living catalog of harness failure modes |
| 8 | `02-IMPROVEMENT-PIPELINE.md` | Operational rhythm — DISCOVERY → DEPRECATE flywheel |

**That's the entire active set.** If a question isn't answered above, the answer either (a) lives in code (read it), (b) lives in `apps/docs/src/content/docs/` (Starlight), or (c) is in `_archive/` history.

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
