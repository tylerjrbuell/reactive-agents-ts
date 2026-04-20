---
name: prune-memory
description: Audit project memory (.agents/MEMORY.md and ~/.claude/.../memory/MEMORY.md) against current code and remove stale claims to prevent bad signals in future sessions
argument-hint: optional --dry-run to report findings without writing
---

# Prune Memory

## Overview

Memory decays. File paths get renamed, dead code gets deleted, "open blockers" get fixed, test counts drift. Stale memory silently poisons every future session — you recommend a function that no longer exists, cite a bug that was fixed, skip a fix because memory said it was already done.

This skill audits every verifiable claim in memory against current code state and removes or updates whatever has drifted.

**Run this:** before major architecture decisions, before a release audit, when memory contradicts observed reality, or once a month as hygiene.

## Scope

Two memory files are in scope:

1. `.agents/MEMORY.md` (repo-committed, shared with other AI agents)
2. `~/.claude/projects/-home-tylerbuell-Documents-AIProjects-reactive-agents-ts/memory/MEMORY.md` (Claude auto-memory)

Both must end the skill in sync.

## What counts as a verifiable claim

Only audit claims the code can falsify. Skip subjective or conversational notes.

| Audit these | Skip these |
|---|---|
| File paths, line numbers, exports | User preferences, feedback memories |
| Function/class names, symbol existence | Architectural philosophy, design rationale |
| Test counts ("X tests across Y files") | Session narratives, roadmap wishes |
| "FIXED" / "OPEN" status on named bugs | Historical "what shipped Mar 27" sections |
| LOC claims ("~560 LOC dead", "190 lines") | External-system pointers (reference memories) |
| Feature wiring ("9/10 decisions advisory") | |

## Step 1 — Extract verifiable claims

Read both MEMORY files. Build a worklist of specific, falsifiable claims. Examples from prior pruning passes:

- "`buildDynamicContext` still in codebase behind flag (~560 LOC dead)"
- "`context-engine.ts` has ~690 LOC mostly dead text-assembly functions"
- "`_riHooks` dead — builder callbacks captured but never invoked"
- "4,153 tests across 461 files"
- "built-in tool count 8 → 11"

Each gets verified independently.

## Step 2 — Verify each claim

Pick the cheapest tool per claim type:

```bash
# Symbol existence / dead code
rtk grep -r "buildDynamicContext" packages --type ts
rtk grep -r "_riHooks" packages/runtime/src/builder.ts -n

# File size / LOC claims
rtk bash "wc -l packages/reasoning/src/context/context-engine.ts"

# Feature wiring — follow the call chain
rtk grep "terminatedBy.*dispatcher-early-stop" packages/reasoning/src/strategies/kernel -n
# Read the handler registry to count wired handlers:
cat packages/reactive-intelligence/src/controller/handlers/index.ts

# Test counts (must run; don't trust memory's number)
bun test 2>&1 | tail -5

# "FIXED on Apr X" claims — cross-check with git log
rtk git log --oneline --grep="fix"
```

Record findings as `CONFIRMED`, `STALE`, or `REMOVED` for each claim.

**Heuristic:** if memory says "X is dead / missing / broken" and `grep` finds X actively imported and called, that memory is stale. If memory says "Y is FIXED" and the referenced file/line doesn't contain the fix, the FIXED marker is a lie — downgrade to OPEN.

## Step 3 — Categorize and plan edits

Three buckets:

1. **Stale contradictions** — memory says "dead" but code says "alive" (or vice versa). *Remove or flip.*
2. **Drifted numerics** — test counts, LOC, file counts. *Update.*
3. **Resolved-but-still-listed** — item marked OPEN in memory is actually fixed. *Move to a "Resolved (reference)" section so it doesn't resurface, but don't delete — the history prevents regressions.*

Never silently delete a FIXED claim — keep it in a reference section so future sessions know the work was done.

## Step 4 — Apply edits

Edit `~/.claude/projects/.../memory/MEMORY.md` first (most-loaded), then sync `.agents/MEMORY.md`.

Rules:
- **Keep claims specific and dated.** "Resolved Apr 19: `_riHooks` wired at `builder.ts:2336`" beats "hooks now work".
- **Include line numbers for new fixed-markers** so the next prune can re-verify in one grep.
- **Do not add forward-looking promises** ("will fix next week"). Only record observable state.
- **Preserve feedback memories** — they decay less than project memories.

## Step 5 — Write an audit summary

Close the loop with a short summary (in chat, not a file) listing:

- Claims verified: N
- Stale entries removed/updated: M
- New "Resolved (reference)" entries: K
- Anything suspicious that needs human judgment (e.g. a FIXED marker with no corresponding code)

## Anti-patterns

- **Batch-deleting "old" sections without verification.** Some old sections remain true. Verify each.
- **Updating test counts without re-running tests.** Never copy a number from a commit message — run `bun test`.
- **Leaving `(see project_foo.md)` pointers after pruning their referenced content.** Update the pointer or remove it.
- **Editing only one of the two MEMORY files.** They drift immediately. Sync before ending the skill.
- **Pruning feedback memories.** User-stated preferences ("don't use Co-Authored-By") don't expire from code drift. Leave them.

## Example session (Apr 19, 2026)

Prior prune pass found four stale architecture-debt entries:

| Claim | Verification | Action |
|---|---|---|
| `buildDynamicContext` ~560 LOC dead | `rtk grep` returned 0 hits in `packages/` | Removed entry |
| `context-engine.ts` ~690 LOC mostly dead | `wc -l` → 190 lines; `buildStaticContext` actively imported | Removed entry |
| `_riHooks` dead, never invoked | `builder.ts:2336–2353` subscribes 3/6 | Moved to Resolved; added 3/6 wired + 3/6 blocked-on-missing-AgentEvent-types |
| 4,153 tests / 461 files | `bun test` → 4,226 pass / 23 skip / 1 fail / 482 files | Updated counts |

Result: 4 stale entries cleaned, 2 new "Resolved (reference)" entries, 1 numeric update, 1 surfaced open issue (the 1 failing test is new info worth investigating separately).
