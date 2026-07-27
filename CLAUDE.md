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

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules (**REVISED 2026-07-27 — graphify is no longer query-first; it was measured**):

- **`grep` is the symbol locator, not graphify.** Measured head-to-head on
  *"where is `low_delta_guard` evaluated and what resets its counter"*: `grep -rn`
  answered in **15ms with the exact site** (`kernel/loop/runner-helpers/tier-guards.ts:62`);
  `graphify query` took **572ms, truncated 148 of 222 nodes, and returned zero
  relevant nodes** (token-counter, providers, cost-resolution). For "where is X",
  "what calls Y", "list uses of Z" — grep first, every time.
- **Use graphify for what it is good at:** broad architecture orientation on
  unfamiliar territory, community/cluster structure, and `graphify path "<A>" "<B>"`
  for relationship questions where you don't yet know the symbol names.
- The MANDATORY query-first PreToolUse hooks were removed — they stapled a nag to
  every Read and Bash call for a tool that lost the head-to-head on the common case.
- `graphify update packages` after out-of-band edits (AST-only, no API cost); the
  post-commit hook rebuilds on every commit.
