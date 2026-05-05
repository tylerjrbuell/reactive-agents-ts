---
type: directory-readme
tags: [planning, convention]
---

# Implementation Plans Directory

> **🎯 This is the canonical location for ALL implementation plans, regardless of which AI agent created them.**

## Convention (Agent-Agnostic)

This directory is the single source of truth for implementation plans across all agents:
- ✅ Claude Code (anthropic/claude-code)
- ✅ Cursor (cursor.sh)
- ✅ Codex / OpenAI Codex CLI
- ✅ Aider (aider.chat)
- ✅ GitHub Copilot Workspace
- ✅ Any other AI coding agent
- ✅ Human-authored plans

## File Naming

```
YYYY-MM-DD-<feature-name>.md
```

Examples:
- `2026-05-05-documentation-audit-consolidation.md`
- `2026-05-10-channels-phase-2.md`
- `2026-06-01-nodejs-support.md`

## Required Frontmatter

```yaml
---
type: implementation-plan
status: active           # active | completed | archived | deferred
created: 2026-05-05
completed: null          # set when status changes to completed
authored-by: claude-code # or cursor, codex, aider, human, etc.
related: []              # wikilinks to related specs/plans/decisions
---
```

## Plan Structure

See `wiki/_Templates/Plan-Template.md` for the canonical structure (or follow superpowers:writing-plans format).

Minimum sections:
1. **Goal** — one sentence
2. **Architecture** — 2-3 sentence approach
3. **Tasks** — bite-sized steps with file paths and code blocks
4. **Self-Review** — coverage checklist

## ⚠️ For superpowers:writing-plans Skill

The skill defaults to saving at `docs/superpowers/plans/YYYY-MM-DD-<feature>.md`.

**OVERRIDE this default to `wiki/Planning/Implementation-Plans/YYYY-MM-DD-<feature>.md`** in this repo.

The `docs/` directory was eliminated in May 2026. Writing there creates orphaned files outside the knowledge graph.

## After Creating a Plan

1. Update [[../Planning-Index|Planning-Index.md]] with a new row in "Active Plans"
2. Cross-link any related specs in `wiki/Architecture/Specs/` or `wiki/Architecture/Design-Specs/`
3. If executing immediately, follow superpowers:executing-plans or subagent-driven-development

## When Plan is Complete

1. Update frontmatter: `status: completed`, `completed: YYYY-MM-DD`
2. Move row in [[../Planning-Index|Planning-Index.md]] from "Active" to "Completed"
3. (Optional) Write a debrief: `wiki/Research/Debriefs/YYYY-MM-DD-<feature>-debrief.md`
4. Cross-link debrief from this plan via wikilink

## Subdirectories

- `Superpowers/` — historical archive of plans created by `superpowers:writing-plans` skill before consolidation. Read-only reference.

## See Also

- [[../Planning-Index|Planning Index]] — full searchable catalog
- [[../../Decisions/Decision Index|Decision Index]] — strategic decision log
- [[../../Architecture/Specs/DOCUMENT_INDEX|Canonical Specs]] — numbered project specs
- `/AGENTS.md` §Plans, Specs & Knowledge Storage — agent-agnostic convention details
