---
aliases: [Doc Consolidation Strategy, Single Source of Truth]
tags: [decision, documentation, consolidation, roadmap]
date: 2026-05-04
status: PLANNING
owner: Documentation Team
phase: Phase 1.5+
---

# Documentation Consolidation Roadmap

**Vision:** Migrate ALL developer documentation into the wiki knowledgebase as the single source of truth. Eliminate fragmented documentation spaces (spec docs, debriefs, plans, markdown files).

**Target:** Phase 1.5+ incrementally migrate existing docs into wiki structure.

---

## Current State (Fragmented)

### Documentation Locations

| Location | Content | Format | Status |
|----------|---------|--------|--------|
| `docs/spec/docs/` | 7 canonical spec docs (00-07) | Markdown | ✅ Current |
| `docs/superpowers/debriefs/` | M1-M13 spike validation debriefs | Markdown | ✅ Current |
| `docs/superpowers/plans/` | 58 tactical plans (mostly archived) | Markdown | 🟡 Archived |
| `wiki/` | Knowledgebase (new, growing) | Obsidian | ✅ Building |
| Root (AGENTS.md, README.md, etc.) | Agent guidance, API overview | Markdown | ✅ Current |
| `apps/docs/` | User-facing Astro site | MDX | ✅ Keep |

### Problems with Fragmentation

1. **Redundancy** — Same info in spec docs + debriefs + wiki
2. **No single truth** — Which doc is authoritative? (Authority hierarchy helps, but still scattered)
3. **Poor cross-reference** — Links between doc spaces break
4. **No agentic queryability** — Obsidian's Dataview/backlinks don't reach markdown files
5. **Git noise** — Changes to spec docs + wiki sync = redundant commits

---

## Desired End State (Unified)

### Single Documentation Knowledgebase

**All developer docs live in wiki:**
- ✅ Mechanism validation (M1-M13) → Experiments folder
- ✅ Failure mode research (FM-A-H) → Failure-Modes folder
- ✅ Architecture decisions → Decisions folder
- ✅ Package documentation → Packages folder
- ✅ Concepts and patterns → Concepts folder
- ✅ Roadmaps and plans → Planning folder
- ✅ Team conventions and patterns → Team folder
- ✅ Release notes and version history → Releases folder
- ✅ Running issues and blockers → Issues folder

**Benefits:**
- Single source of truth (no redundancy)
- Rich cross-linking (backlinks show what depends on what)
- Agentic queryability (Dataview, semantic search via Tier 2 M10)
- Git-friendly (single folder to track, easy diffs)
- Version control (all changes in git history)

---

## Migration Strategy

### Phase 1.5: Foundation (Current → Immediate)

**Goal:** Establish wiki as primary authoring location; keep spec docs as references.

#### Step 1: Link & Redirect
- ✅ Link wiki notes from spec docs (`00-VISION.md` → `wiki/Home.md`)
- ✅ Spec docs become "archived snapshot" of decisions from earlier phases
- **Action:** Update DOCUMENT_INDEX.md to note "canonical source now in wiki/"

#### Step 2: Authority Transfer
- Wiki MOCs become authoritative (Architecture MOC, Research MOC, Decisions MOC)
- Spec docs become read-only historical records (labeled "Snapshot as of 2026-05-04")
- **Action:** Add frontmatter to spec docs: "See wiki/ for current state"

#### Step 3: Debrief Integration
- ✅ M4, M8, M9, M10, M11, M12, M13 debriefs → Linked from wiki/Experiments/M#
- Link to debrief from mechanism note (not copy)
- Eventually: Migrate debrief key findings into wiki notes

**Timeline:** Complete by end of Phase 1.5

---

### Phase 2: Expansion

**Goal:** Migrate all spec docs and decision history into wiki.

#### Step 1: Spec Doc Migration
- 00-VISION.md → Merge into `wiki/Decisions/North Star v3.0.md`
- 01-RESEARCH-DISCIPLINE.md → Merge into `wiki/Concepts/Research Discipline.md`
- 02-FAILURE-MODES.md → Merge into `wiki/Failure-Modes/00 FM Catalog.md`
- 03-IMPROVEMENT-PIPELINE.md → Merge into `wiki/MOCs/Research MOC.md`
- 04-PROJECT-STATE.md → Merge into `wiki/Hot.md` (recent context)
- 05-DESIGN-NORTH-STAR.md → Merge into `wiki/Decisions/North Star v3.0.md`
- 06-AUDIT-v0.10.0.md → Migrate findings to individual mechanism notes
- 07-ROADMAP-v1.0.md → Create `wiki/Planning/Roadmap v1.0.md`

#### Step 2: Plan Migration
- Archived tactical plans (57 in `plans/archive/`) → Keep as historical reference OR migrate summaries to wiki decisions
- Active plans → Migrate to wiki Planning folder

#### Step 3: Decision History
- Create `wiki/Decisions/Decision Index.md` → Catalog ALL decisions
- Create individual decision notes with date, options, rationale, outcomes
- Link decisions to affected mechanism notes and package notes

**Timeline:** Phases 2-3

---

### Phase 3+: Completion

**Goal:** Wiki is the ONLY source of truth for developer docs.

#### Step 1: Cleanup
- Mark spec docs directory as "Archived Reference Only" (readonly)
- Remove redundant markdown files from root
- Keep only: AGENTS.md (quick ref), README.md (user-facing), CLAUDE.md (pointer)

#### Step 2: Audit Trail
- All git history preserved (no loss of context)
- Commits reference wiki page names instead of markdown file paths
- CHANGELOG references wiki documentation

#### Step 3: Integration
- CI/CD updates reference wiki instead of spec docs
- Team workflows default to wiki for documentation
- New decision docs always created in wiki (never spec docs)

**Timeline:** Phase 3+

---

## Migration Checklist

### Phase 1.5 (Immediate)

- [ ] Link wiki MOCs from spec docs (header pointers)
- [ ] Create `wiki/Planning/` folder for roadmaps and plans
- [ ] Link all debriefs from mechanism notes (M4, M8-M13 done; M1-M3, M5-M7 pending)
- [ ] Create `wiki/Team/` folder for conventions and patterns
- [ ] Create `wiki/Releases/` folder for version history
- [ ] Add frontmatter to spec docs: "Canonical source now in wiki/"
- [ ] Update DOCUMENT_INDEX.md with wiki references
- [ ] All team PRs reference wiki docs instead of spec docs

### Phase 2 (Major Consolidation)

- [ ] Migrate 00-VISION.md → wiki
- [ ] Migrate 01-RESEARCH-DISCIPLINE.md → wiki
- [ ] Migrate 02-FAILURE-MODES.md → wiki (FM-A-H already done)
- [ ] Migrate 03-IMPROVEMENT-PIPELINE.md → wiki
- [ ] Migrate 04-PROJECT-STATE.md → wiki (Hot.md replaces)
- [ ] Migrate 05-DESIGN-NORTH-STAR.md → wiki
- [ ] Migrate 06-AUDIT-v0.10.0.md → Individual mechanism notes
- [ ] Migrate 07-ROADMAP-v1.0.md → wiki
- [ ] Migrate decision history from git log → wiki Decision Index
- [ ] Archive tactical plans → Summarize in wiki or delete
- [ ] Mark spec docs directory readonly

### Phase 3+ (Final State)

- [ ] Spec docs directory deprecated (move to `_archive/`)
- [ ] Root markdown cleanup (keep only AGENTS.md, README.md, CLAUDE.md)
- [ ] All new decisions documented in wiki only
- [ ] All new mechanisms validated in wiki
- [ ] Wiki becomes primary developer onboarding path

---

## What Stays Where

### Keep in Wiki ✅
- Architecture (all 12 phases, packages, ports)
- Mechanism validation (M1-M13 with verdicts)
- Failure modes (FM-A-H with empirical evidence)
- Decisions (phase gates, trade-offs, rationale)
- Package documentation (purpose, ownership, key files)
- Concepts and patterns (design principles, learning)
- Roadmaps and plans (future work, phase gates)
- Issues and blockers (running log with owners)
- Team conventions (patterns, release process)
- Release notes and version history

### Keep in Root (High-Signal Only) 📌
- **AGENTS.md** — Quick reference for developers (5-10 min orientation)
- **README.md** — User-facing API overview
- **CLAUDE.md** — Pointer to AGENTS.md (for agent tools)
- **CHANGELOG.md** — Release notes (mirrors wiki/Releases/)

### Keep Elsewhere 🌐
- **apps/docs/** — User-facing Astro documentation site (stays separate)
- **CONTRIBUTING.md** — Contributor guidelines (can reference wiki)
- **.github/ISSUE_TEMPLATE/** — GitHub templates (lightweight, stay in repo)

### Archive/Delete 🗑️
- **docs/spec/docs/*** — Mark as "Snapshot 2026-05-04" (readonly reference)
- **docs/superpowers/plans/archive/*** — Summarize key items or delete
- Duplicate MEMORY.md entries (consolidate into wiki)

---

## Benefits of Consolidation

### For Developers
- **Single source of truth** — No confusion about which doc is current
- **Rich cross-linking** — Click backlinks to see what depends on a decision
- **Agentic queryability** — AI agents can ask "Show me all FM-A mitigations" and get results
- **Version tracking** — Git history shows evolution of decisions
- **Offline capable** — Clone wiki/ and have full reference locally

### For Teams
- **Reduced redundancy** — Write once, referenced many
- **Easier onboarding** — Single entry point (wiki/Home.md)
- **Better discovery** — Tags, backlinks, dataview queries surface related docs
- **Audit trail** — All decisions documented with rationale and date
- **Git-friendly** — Fewer merge conflicts (single folder vs scattered markdown)

### For Agentic Work
- **Queryability** — "Which mechanisms mitigate FM-A?" → backlinks show M4, M13
- **Context efficiency** — Agentic queries stay within wiki (high signal, low noise)
- **Rapid onboarding** — Agents read wiki/Hot.md + 2-3 MOCs and have full context
- **Decision tracing** — Understand WHY decisions were made (rationale + trade-offs documented)

---

## Implementation Notes

### Obsidian Sync
The wiki currently uses `obsidian-git` plugin for git sync. This allows:
- Edits in Obsidian sync to git
- Git commits sync to Obsidian
- No manual push/pull needed

**Recommendation:** Configure wiki as part of CI/CD so edits to wiki trigger doc validation.

### Dataview Queries
Leverage Obsidian Dataview to create dynamic indexes:

```dataquery
table
  verdict,
  owner,
  date
from #experiment
where verdict = "KEEP"
sort date descending
```

This creates an auto-updating table of all KEEP mechanisms without maintenance.

### Semantic Search (Phase 1.5+)
Implement M10 Tier 2 semantic search to enable natural language queries:
- "Show me all mechanisms that mitigate tool errors"
- "What failure modes affect long conversations?"
- "Which packages have architectural debt?"

---

## Timeline

| Phase | Timeframe | Milestone |
|-------|-----------|-----------|
| Phase 1.5 | May-June | Establish wiki as primary; link from spec docs |
| Phase 2 | June-July | Migrate spec docs and decision history |
| Phase 3+ | August+ | Archive old docs; wiki only authoring |

---

## Success Criteria

- ✅ Phase 1.5: 90% of developer queries answered from wiki
- ✅ Phase 2: Spec docs deprecated (marked readonly)
- ✅ Phase 3: Zero references to old spec docs in new code/decisions
- ✅ All phases: Agentic context queries work (backlinks, tags, dataview)

---

## References

- [[MOCs/Research MOC|Research MOC]] — Mechanism validation (already in wiki)
- [[Failure-Modes/00 FM Catalog|FM Catalog]] — Failure modes (already in wiki)
- [[MOCs/Decisions MOC|Decisions MOC]] — Strategic decisions (already in wiki)
- [[Packages/00 Package Index|Package Index]] — Package documentation (already in wiki)

---

**Last Updated:** 2026-05-04  
**Status:** PLANNING (Phase 1.5 kickoff)  
**Owner:** Documentation Team
