# Agent Workflow Guide

**Read `AGENTS.md` (root) — it is the single canonical source for all agent instruction.**

## Fast orientation (before reading AGENTS.md in full)

1. `wiki/Hot.md` — recent session state, ≤130 lines, cheaper than any other entry point
2. `claude-obsidian:wiki-query` — for anything specific (prior decisions, failure modes, package detail); beats `grep`/`find` across 550+ wiki files and doesn't require reading AGENTS.md first
3. `AGENTS.md` §Canonical Documents & Read Order — for full session setup

Do not use `wiki/Home.md` as an index — it is a stub page, not a MOC router (see its own banner).

## 🎯 Critical Convention: Knowledge Storage

**All plans, specs, decisions, and debriefs go to `wiki/`. This applies regardless of which agent (Claude/Cursor/Codex/Aider/etc.) you are.**

| Content              | Location                                                     |
| -------------------- | ------------------------------------------------------------ |
| Implementation plans | `wiki/Planning/Implementation-Plans/YYYY-MM-DD-<feature>.md` |
| Architecture specs   | `wiki/Architecture/Design-Specs/YYYY-MM-DD-<spec>.md`        |
| Decisions / RFCs     | `wiki/Decisions/YYYY-MM-DD-<decision>.md`                    |
| Debriefs             | `wiki/Research/Debriefs/YYYY-MM-DD-<feature>-debrief.md`     |
| Audit reports        | `wiki/Research/Audit-Reports-YYYY-MM-DD/`                    |

### ⚠️ For superpowers:writing-plans skill

The skill defaults to `docs/superpowers/plans/`. **OVERRIDE this default to `wiki/Planning/Implementation-Plans/`.** The `docs/` directory was eliminated in May 2026 consolidation. Writing to it creates orphaned files outside the knowledge graph.

### Why this matters

-   **Single source of truth** — agents share knowledge across sessions
-   **Token optimization** — one vault, one index, one query
-   **Cross-agent continuity** — Cursor reads Claude's plans, etc.
-   **No clutter** — root has 8 .md files (entry points), all knowledge lives in `wiki/`. `NAVIGATION.md` and `QUICK_START.md` were folded into `wiki/Development/Repo-Navigation.md` on 2026-08-18 — `AGENTS.md` is the sole root entry point now.

---

See also:

-   `AGENTS.md` — canonical agent workflow + build commands (root, sole entry point)
-   `wiki/Development/Repo-Navigation.md` — repo structure map + task-pattern recipes
-   `wiki/Home.md` — knowledge vault index
-   `wiki/Hot.md` — recent context cache (read for current state)
-   `apps/cortex/AGENTS.md` — when working in that app
-   `README.md` — user-facing API overview
-   `CHANGELOG.md` — release history
