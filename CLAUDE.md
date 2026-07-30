# Agent Workflow Guide

**Read `AGENTS.md` (root) — it is the single canonical source for all agent instruction.**

## 🎯 Critical Convention: Knowledge Storage

**All plans, specs, decisions, and debriefs go to `wiki/`. This applies regardless of which agent (Claude/Cursor/Codex/Aider/etc.) you are.**

| Content | Location |
|---------|----------|
| Implementation plans | `wiki/Planning/Implementation-Plans/YYYY-MM-DD-<feature>.md` |
| Architecture specs | `wiki/Architecture/Design-Specs/YYYY-MM-DD-<spec>.md` |
| Decisions / RFCs | `wiki/Decisions/YYYY-MM-DD-<decision>.md` |
| Debriefs | `wiki/Research/Debriefs/YYYY-MM-DD-<feature>-debrief.md` |
| Audit reports | `wiki/Research/Audit-Reports-YYYY-MM-DD/` |

### ⚠️ For superpowers:writing-plans skill

The skill defaults to `docs/superpowers/plans/`. **OVERRIDE this default to `wiki/Planning/Implementation-Plans/`.** The `docs/` directory was eliminated in May 2026 consolidation. Writing to it creates orphaned files outside the knowledge graph.

### Why this matters

- **Single source of truth** — agents share knowledge across sessions
- **Token optimization** — one vault, one index, one query
- **Cross-agent continuity** — Cursor reads Claude's plans, etc.
- **No clutter** — root has 10 .md files (entry points), all knowledge lives in `wiki/`

---

See also:

- `AGENTS.md` — canonical agent workflow + build commands (root)
- `NAVIGATION.md` — repo structure + entry points (root)
- `wiki/Home.md` — knowledge vault index
- `wiki/Hot.md` — recent context cache (read for current state)
- `apps/cortex/AGENTS.md` — when working in that app
- `README.md` — user-facing API overview
- `CHANGELOG.md` — release history
