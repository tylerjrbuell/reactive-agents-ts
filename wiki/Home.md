---
aliases: [Reactive Agents Project Brain]
tags: [MOC, root]
---

# Reactive Agents Project Brain

> [!note] This page is a stub, not an index
> The `MOCs/` layer this page used to route through hasn't been maintained since the May 2026
> vault scaffold — 18 of the current packages predate its stub pages, `Concepts/` was never
> created, and its decision links predate the current `YYYY-MM-DD-<slug>` filename convention.
> Regenerating it was scoped out of the 2026-07-31 cleanup pass (high hallucination risk to
> rebuild without the session context that produced it). Don't route through `MOCs/` — use
> `claude-obsidian:wiki-query` against the directories below instead, or the pointers here.

**Purpose:** knowledge vault for the reactive-agents-ts framework — architecture, research,
decisions, and planning history, agent-agnostic (Claude/Cursor/Codex/etc. all write here).

## Start here

1. [[Hot|Hot.md]] — recent session context cache, read this first every session
2. `claude-obsidian:wiki-query` — for anything specific; beats grepping 550+ files by hand
3. [[Architecture/DEBT-REGISTER|Architecture/DEBT-REGISTER.md]] — canonical technical-debt ledger
4. [[Architecture/Specs/09-UNIFIED-PROGRAM|Architecture/Specs/09-UNIFIED-PROGRAM.md]] — canonical sequencing/direction

## Directory map

| Content type | Location |
|---|---|
| Implementation plans | `Planning/Implementation-Plans/YYYY-MM-DD-<feature>.md` |
| Canonical numbered specs | `Architecture/Specs/NN-NAME.md` — see `DOCUMENT_INDEX.md` for authority order |
| Architecture design specs | `Architecture/Design-Specs/YYYY-MM-DD-<spec>.md` |
| Decisions / RFCs | `Decisions/YYYY-MM-DD-<decision>.md` |
| Post-feature debriefs | `Research/Debriefs/YYYY-MM-DD-<feature>-debrief.md` |
| Audit reports | `Research/Audit-Reports-YYYY-MM-DD/` |
| Failure modes | `Failure-Modes/` — `FM-<X>-<name>.md`, catalog at `Failure-Modes/00 FM Catalog.md` |
| Harness probe reports | `Research/Harness-Reports/` (large — most content is raw trace data, not prose) |
| Running issues | `Issues/Running Issues Log.md` |

## Keeping it fresh

- Update [[Hot|Hot.md]] at session end with key changes and next steps
- New durable artifact → `claude-obsidian:save` / `wiki-ingest`, not a raw `Write`
- Periodic health check → `claude-obsidian:wiki-lint` (orphans, dead links, stale frontmatter)

**Last reviewed:** 2026-08-18 (this rewrite, cut from a MOC-routing page to a stub index)
