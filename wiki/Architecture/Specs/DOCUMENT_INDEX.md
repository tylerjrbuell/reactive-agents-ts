# Document Index — `wiki/Architecture/Specs/`

> **Last updated:** 2026-07-12 (authority hierarchy rewritten; 08/09 indexed; 04 deprecated as state read).
> **Purpose:** Map every document in this directory to its purpose. Ranked from "read first" to "reference when needed."
>
> **Authority:** Uniform numbering `NN-NAME.md` (00–09). Single source of truth for agent guidance per AGENTS.md.

---

## Canonical documents (read in this order)

| # | File | Purpose |
|---|---|---|
| 0 | `wiki/Hot.md` (not in this dir) | Session-start current state; points at the latest state snapshot |
| 1 | `09-UNIFIED-PROGRAM.md` | **CANONICAL sequencing + convergence authority** (2026-07-08) — K/P/T strands, Waves A–G, release slicing |
| 2 | `08-AGENTIC-OS-NORTH-STAR.md` | v6.0 (ratified 2026-07-05) — product-arc content, exit gates, honest-claims law, non-goals |
| 3 | `../Design-Specs/2026-07-11-harness-north-star-architecture.md` | Kernel architecture (RATIFIED 2026-07-11) |
| 4 | `05-DESIGN-NORTH-STAR.md` | v5.0 architecture reference (superseded for forward sequencing by 08/09) |
| 5 | `01-RESEARCH-DISCIPLINE.md` | 12 rules for every harness change; methodology contract |
| 6 | `02-FAILURE-MODES.md` | Living catalog of harness failure modes (FM-A1, FM-B2, etc.) |
| 7 | `03-IMPROVEMENT-PIPELINE.md` | Operational rhythm — DISCOVERY → DEPRECATE flywheel |
| 8 | `00-VISION.md` | What we're building toward. Stable anchor. |

**Historical (do not treat as current):** `04-PROJECT-STATE.md` (2026-04-27 snapshot, deprecated banner added 07-12), `07-ROADMAP-v1.0.md` + `06-AUDIT-v0.10.0.md` (v0.10-era; superseded by root `ROADMAP.md` + 08/09), `START_HERE_AI_AGENTS.md` (points at deprecated 04 — prefer `wiki/Hot.md`).

**Authority Hierarchy (2026-07-12):**

- `09-UNIFIED-PROGRAM.md` > `08-AGENTIC-OS-NORTH-STAR.md` v6.0 > `2026-07-11-harness-north-star-architecture.md` > active plans > evidence (bench reports/ledger).
- If docs conflict: amend lower-authority doc, never silent drift. Changing a higher doc is a ratification event (decision doc).

**That's the entire active set.** If a question isn't answered above, the answer either (a) lives in code (read it), (b) lives in `apps/docs/src/content/docs/` (Starlight), or (c) is in `wiki/Planning/Implementation-Plans/Superpowers/archive/` (historical).

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
