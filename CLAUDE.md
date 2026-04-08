# CLAUDE Compatibility Notice

This repository now uses AGENTS.md as the single canonical agent workflow guide.

Use these files in order:
1. `AGENTS.md` (root) for architecture, workflow, quality gates, and documentation policy.
2. `apps/cortex/AGENTS.md` when working inside `apps/cortex/`.
3. `README.md` and `apps/docs/src/content/docs/` for user-facing APIs and behavior.
4. `CHANGELOG.md` for release history and migration details.

`CLAUDE.md` is intentionally kept as a lightweight compatibility pointer to avoid maintaining duplicate guidance.
