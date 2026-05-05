---
type: workflow-guide
tags: [development, workflow, wiki, claude-obsidian]
audience: all-agents
created: 2026-05-05
---

# Wiki Workflow — Canonical Pattern for All Agents

> **🎯 Read this before any session that involves the wiki.** Defines the standard 4-step pattern that every agent (Claude/Cursor/Codex/Aider) and skill (harness-improvement-loop, update-docs, architecture-audit, etc.) follows when interacting with `wiki/`.

## The 4-Step Pattern

```
1. ORIENT  — Query before forming hypotheses
2. CAPTURE — Use proper Obsidian Markdown for any wiki write
3. PERSIST — Save durable artifacts as you complete work
4. MAINTAIN — Periodic graph hygiene (lint, fold)
```

This pattern is enforced via the `claude-obsidian:*` skill family. When in doubt, use these skills instead of raw `grep`/`find`/`Write`.

---

## Step 1 — ORIENT (before forming hypotheses)

**Goal:** Find prior context. Don't reinvent solutions or duplicate research.

### Primary tool: `claude-obsidian:wiki-query`

Reads hot cache → index → drills into specific notes. Returns relevant content with summaries, not raw grep output.

**When to use:**
- Starting any non-trivial task — what does the wiki already say about this?
- Before forming a hypothesis (especially in harness-improvement-loop Phase 1)
- Before designing a new feature (find related decisions, prior plans)
- When debugging a class of issue (find prior debriefs and failure modes)

**Example queries:**
```
"What failure modes does context curation address?"
"Find decisions about kernel phase ordering"
"Show recent harness improvement runs for ollama tier"
"What's the status of M3 verifier retry?"
```

### Fallback: targeted `grep`

If `wiki-query` is unavailable or you need exact-string matching:
```bash
grep -rln "exact-symbol" wiki/ --include="*.md"
```

But prefer `wiki-query` for semantic queries — it surfaces matches that grep misses.

### When external research is needed: `claude-obsidian:autoresearch`

If the topic isn't in the wiki AND grep returns nothing relevant, the failure/topic is genuinely new. Kick off autonomous research:
```
claude-obsidian:autoresearch "<topic>"
```
This searches the web, fetches sources, ingests them into the wiki. The result is a structured wiki page you can build on.

**Don't autoresearch when wiki-query already returns useful context.** Avoid duplicating the project's existing knowledge.

---

## Step 2 — CAPTURE (writing to the wiki correctly)

**Goal:** All wiki writes use proper Obsidian Flavored Markdown so the graph stays coherent.

### Primary tool: `claude-obsidian:obsidian-markdown`

When you need to write or edit a wiki page, invoke this skill to ensure correct OFM:
- Wikilinks: `[[Path/Note|Display Text]]`
- Properties (frontmatter): YAML at top with `type`, `tags`, `created`
- Callouts: `> [!note]` `> [!warning]` `> [!important]`
- Tags: `#topic` (in body) or `tags: [topic]` (frontmatter)
- Embeds: `![[Path/Note]]` for transclusion

### Required frontmatter for every wiki page

```yaml
---
type: <implementation-plan|decision|spec|debrief|experiment|concept|moc|reference>
status: <active|completed|archived|deferred>  # for plans/experiments
tags: [<topic-tags>]
created: YYYY-MM-DD
authored-by: <claude-code|cursor|codex|aider|human>
related: [[<related-note>]]  # at least one wikilink
---
```

### Write tools by purpose

| Goal | Tool | Notes |
|------|------|-------|
| Save current conversation/insight as wiki page | `claude-obsidian:save` | Auto-structures with frontmatter |
| Ingest external source (URL, paper) into wiki | `claude-obsidian:wiki-ingest` | Extracts entities/concepts |
| Strip web clutter before ingest | `claude-obsidian:defuddle` | Use before wiki-ingest on URLs |
| Edit existing wiki file | `Edit` (Claude Code) | Validate OFM via obsidian-markdown |
| Visual layout | `claude-obsidian:canvas` | For multi-mechanism investigations |

---

## Step 3 — PERSIST (durable artifacts as you complete work)

**Goal:** Every significant finding becomes a durable wiki artifact discoverable by future agents.

### When to PERSIST

| Trigger | What to write | Where | Tool |
|---------|---------------|-------|------|
| Significant fix shipped | Debrief | `wiki/Research/Debriefs/YYYY-MM-DD-<feature>-debrief.md` | `save` or manual |
| New failure mode discovered | FM page | `wiki/Failure-Modes/FM-<X>-<name>.md` | `save` or manual |
| Architectural decision made | Decision record | `wiki/Decisions/YYYY-MM-DD-<decision>.md` | `save` |
| Mechanism behavior changed | Update Experiment | `wiki/Experiments/M<N>-<name>.md` | `Edit` |
| Plan complete | Update plan + Index | `wiki/Planning/Implementation-Plans/<plan>` + `Planning-Index.md` | `Edit` |
| External research completed | Ingest into wiki | `wiki/Research/<topic>/` | `wiki-ingest` |
| Active blocker found | Issue entry | `wiki/Issues/Running Issues Log.md` | `Edit` |
| Audit/spike report | Research report | `wiki/Research/<Audit-Reports-YYYY-MM-DD or Harness-Reports>/` | `Write` |

### Cross-link discipline

Every new wiki page MUST link to at least one existing wiki page. Without backlinks the graph fragments. Use:
- `[[MOCs/Architecture MOC]]` to link from a new spec
- `[[Decisions/Decision Index]]` to link a new decision
- `[[Failure-Modes/FM-A Tool Engagement]]` to link a debrief that addresses an FM

If the related note doesn't exist yet, either create it (stub note OK) or link to a parent MOC.

---

## Step 4 — MAINTAIN (periodic graph hygiene)

**Goal:** Keep the wiki graph healthy. Catch orphans, dead links, stale claims early.

### After every session (5 min): `claude-obsidian:wiki-lint`

Runs a health check covering:
- **Orphan pages** — no inbound links (signal: needs MOC update or removal)
- **Dead wikilinks** — `[[Note]]` to non-existent file (signal: rename/typo)
- **Stale frontmatter** — `status: active` plans completed >30 days ago
- **Empty sections** — placeholder headers without content
- **Missing index entries** — files not referenced from any MOC or Index

Output: lint report. Fix top issues. Defer low-priority to next pass.

### Monthly: `claude-obsidian:wiki-fold`

Roll up high-volume directories into meta-pages:
- 60+ implementation plans → quarter-by-quarter rollup
- 50+ debriefs → mechanism-organized rollup
- 100+ harness reports → phase-organized rollup

`wiki-fold` reads logs in powers of 2 (last 2, 4, 8, 16, 32, 64 entries) and produces compact summaries. The originals stay; the rollup is a navigable cache.

### When restructuring: `claude-obsidian:wiki`

Health-check the whole vault. Validates:
- Vault structure matches expected layout (MOCs, _Templates, _archive)
- Required indexes exist (Planning-Index, Decision-Index, Document-Index)
- Frontmatter compliance across all notes
- Backup/snapshot before destructive changes

---

## Quick Reference: claude-obsidian Skills

| Skill | One-liner |
|-------|-----------|
| `wiki` | Bootstrap/check vault. Use when restructuring or onboarding |
| `wiki-query` | Ask the wiki anything. Hot-cache aware, beats grep |
| `wiki-ingest` | Ingest external source (URL, file, transcript) → structured wiki page |
| `wiki-lint` | Health check: orphans, dead links, stale claims |
| `wiki-fold` | Roll up high-volume logs into meta-pages |
| `save` | Save current conversation/insight as wiki page |
| `obsidian-markdown` | Write correct OFM (wikilinks, callouts, properties) |
| `obsidian-bases` | Create `.base` files for dynamic database views |
| `canvas` | Visual canvas for spatial layouts |
| `autoresearch` | Autonomous web research → ingest synthesis |
| `defuddle` | Strip web clutter before wiki-ingest |

---

## Obsidian Bases (Dynamic Indexes)

The wiki uses `.base` files as dynamic queries — instead of manually maintaining indexes, Bases auto-update from frontmatter.

**Existing bases:**
- `wiki/Planning/active-plans.base` — all plans where `status: active`
- `wiki/Experiments/by-verdict.base` — M-series grouped by KEEP/IMPROVE
- `wiki/Failure-Modes/by-severity.base` — FMs sorted by impact
- `wiki/Research/Harness-Reports/recent.base` — last 30 days

**Creating a new base:** Use `claude-obsidian:obsidian-bases` skill — generates valid YAML for Obsidian Bases.

---

## Pattern Examples

### Example 1: Starting a new harness improvement session

```
1. ORIENT
   → wiki-query "harness failure cogito:14b verifier"
   → Found: wiki/Experiments/M3-verifier-retry.md, wiki/Research/Debriefs/M3-*.md
   → Saves 30 min of grep/read

2. (Run probe, diagnose via rax-diagnose)

3. PERSIST (after fix lands)
   → save "M3 retry-context tuning for cogito:14b" as debrief
   → Auto-creates wiki/Research/Debriefs/2026-05-05-m3-cogito-retry-debrief.md
   → Wikilinks back to M3 Experiment + FM-A1

4. MAINTAIN (end of session)
   → wiki-lint (catches that the debrief needs FM-A1 backlink update)
```

### Example 2: Implementing a new feature

```
1. ORIENT
   → wiki-query "cost routing decision adaptive"
   → Returns: 3 prior decisions, 2 related plans, 1 spec
   → Read DOCUMENT_INDEX entries for context

2. (Write plan to wiki/Planning/Implementation-Plans/, implement)

3. PERSIST
   → On completion: update plan frontmatter (status: completed)
   → Update Planning-Index.md
   → save "<feature> shipped" as debrief if architecturally significant

4. MAINTAIN
   → wiki-lint to catch any frontmatter typos or missing backlinks
```

### Example 3: Investigating an unfamiliar failure

```
1. ORIENT
   → wiki-query "tool name hallucination ollama"
   → Returns: nothing strongly relevant

2. → autoresearch "tool name hallucination in local LLMs Ollama function calling"
   → Searches web, ingests papers/blog posts → wiki/Research/Tool-Name-Hallucination/
   → Now have grounded external context

3. (Diagnose, hypothesize, fix)

4. PERSIST
   → save fix as debrief, link to autoresearch wiki page
```

---

## Anti-Patterns

- ❌ **Reading individual files when `wiki-query` would surface them faster**
  - Wiki-query reads the hot cache + index, not just files. It surfaces semantic matches.

- ❌ **Writing to wiki without frontmatter**
  - Breaks Obsidian queries, Bases, and graph navigation.

- ❌ **Skipping cross-links**
  - Every wiki page needs at least one inbound wikilink (from MOC, Index, or related page).

- ❌ **Ignoring lint warnings**
  - The graph degrades silently. Fix orphans and dead links promptly.

- ❌ **Manually maintaining indexes that could be Bases**
  - If it's a frontmatter query, use a `.base` file. Manual indexes drift.

- ❌ **Autoresearch for topics already in the wiki**
  - Wastes tokens. Always wiki-query first.

---

## Adoption by Skills

These skills reference this workflow:

| Skill | Where it integrates | Phase |
|-------|---------------------|-------|
| `harness-improvement-loop` | Phase 1 Orient + Phase 7 Commit + Pass cleanup | All |
| `update-docs` | Capture step (writes wiki entries) | Capture |
| `architecture-audit` | Orient (find prior decisions) + Persist (audit reports) | Orient + Persist |
| `architecture-reference` | Orient (lookup architectural context) | Orient |
| `prepare-release` | Persist (release notes from debriefs) + Maintain (fold) | Persist + Maintain |
| `effect-abstraction-audit` | Orient + Persist | Orient + Persist |

---

## See Also

- [[Planning/Planning-Index|Planning Index]] — all implementation plans
- [[Decisions/Decision Index|Decision Index]] — strategic decisions
- [[Architecture/Specs/DOCUMENT_INDEX|Spec Document Index]] — canonical specs
- [[../Home|Wiki Home]] — vault entry point
- `/AGENTS.md` §Plans, Specs & Knowledge Storage — agent-agnostic storage convention
- `.agents/skills/harness-improvement-loop/SKILL.md` — the canonical example of this workflow in action
