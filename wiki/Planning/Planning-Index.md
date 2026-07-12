---
type: index
tags: [planning, index, implementation-plans]
updated: 2026-05-05
---

# Planning Index

**Single source of truth for all implementation plans.** This index covers plans from any AI agent (Claude Code, Cursor, Codex, Aider) and human-authored plans alike.

## 📍 Storage Convention

All plans live in: `wiki/Planning/Implementation-Plans/YYYY-MM-DD-<feature-name>.md`

**Naming pattern:**
- `YYYY-MM-DD-<feature-name>.md` for plans
- `YYYY-MM-DD-<feature-name>-design.md` for design docs that precede plans
- `YYYY-MM-DD-<feature-name>-debrief.md` goes to `wiki/Research/Debriefs/`

**Required frontmatter:**
```yaml
---
type: implementation-plan
status: active|completed|archived|deferred
created: YYYY-MM-DD
completed: YYYY-MM-DD or null
authored-by: <agent-or-human>
related: [[<related-plan-or-spec>]]
---
```

## 🚀 For superpowers:writing-plans skill users

The skill defaults to `docs/superpowers/plans/`. **OVERRIDE to `wiki/Planning/Implementation-Plans/`.** The legacy directory was eliminated in May 2026 consolidation.

---

## Active Plans

| Date | Plan | Status | Owner |
|------|------|--------|-------|
| 2026-07-11 | [[Implementation-Plans/2026-07-11-subagents-and-logging\|Subagents + Unified Logging]] | ⬜ DRAFT — awaiting RATIFY | Claude Code |
| 2026-07-10 | [[Implementation-Plans/2026-07-10-harness-root-cause-closure-program\|Harness Root-Cause Closure Program]] | 🔄 Active (Tier 1–3 open list = canonical backlog) | Claude Code |
| 2026-07-10 | [[Implementation-Plans/2026-07-10-goal-reliability-and-feedback-loop-program\|Goal-Reliability + Feedback-Loop Program]] | 🔄 Active (open: #44 spine, #39 per-entity, #38 ablation, B4) | Claude Code |

## Completed Plans (2026)

### July 2026 (harness root-cause fortnight — see `wiki/Research/Audit-Reports-2026-07-12/00-STATE-OF-THE-FRAMEWORK.md` for the full scoreboard)
- 2026-07-09 — [[Implementation-Plans/2026-07-09-capability-measurement-wave|Capability measurement wave]] — ◐ partial, superseded-in-part by root-cause program
- 2026-07-08 — [[Implementation-Plans/2026-07-08-meta-loop-execution-plan|Meta-loop execution plan (Waves A–G)]] — ✅ fully executed 2026-07-08
- 2026-07-07 — [[Implementation-Plans/2026-07-07-adaptive-harness-overhaul|Adaptive harness overhaul (9-pillar)]] — ✅ all phases shipped; Phase-6 exit gate unmet (ablation INCONCLUSIVE)
- 2026-07-05 — [[Implementation-Plans/2026-07-05-agentic-os-arc1-log-process-receipt|Agentic OS Arc 1 (Log/Process/Receipt)]] — ✅ merged `3c9c15fa`; launch-gate item 5 (bench receipts) open
- 2026-07-05 — [[Implementation-Plans/2026-07-05-agentic-ui-kit-p1-uicore-controllers|Agentic UI Kit P1 — ui-core controllers]] — ✅ (v0.13.5)
- 2026-07-05 — [[Implementation-Plans/2026-07-05-groq-xai-providers|Groq + xAI providers]] — ✅ (v0.13.5)
- 2026-07-03 — [[Implementation-Plans/2026-07-03-agentic-ui-kit-p3-react|Agentic UI Kit P3 — React]] · [[Implementation-Plans/2026-07-03-agentic-ui-kit-svelte-cortex|Svelte + Cortex]] — ✅
- 2026-07-02 — [[Implementation-Plans/2026-07-02-agentic-ui-kit|Agentic UI Kit]] · [[Implementation-Plans/2026-07-02-cortex-dynamic-sync-parity-run-control|Cortex dynamic sync]] · [[Implementation-Plans/2026-07-02-security-hardening-wave|Security hardening wave]] · [[Implementation-Plans/2026-07-02-agentic-ui-kit-cortex-showcase|Cortex showcase]] — ✅
- 2026-07-01 — [[Implementation-Plans/2026-07-01-v13-lift-execution|v0.13 lift execution]] — ✅ shipped in v0.13.x; superseded as direction by 09-UNIFIED-PROGRAM
- 2026-07-01 — [[Implementation-Plans/2026-07-01-cross-tier-thinking|Cross-tier thinking]] · [[Implementation-Plans/2026-07-01-docs-revamp|Docs revamp]] — ✅

### May 2026
- 2026-05-05 — Documentation audit & consolidation (this consolidation pass)

### April 2026 (Recent Major Work)
- v0.10.0 release prep
- Kernel architecture rescue
- Adaptive tool calling system
- Channels package phase 1

### March 2026
- 2026-03-XX — Multiple plans for kernel, gateway, memory, strategies (see file list)

### February 2026
- 2026-02-25 — Metrics dashboard
- 2026-02-26 — Examples suite
- 2026-02-27 — Tool result compression, reasoning strategy improvements
- 2026-02-28 — Agent gateway, messaging channels

> **Note:** ~36 plans from Feb-Apr 2026 live in `Implementation-Plans/`. Most are complete; check git log or content for status. Future plans should be added with explicit `status:` frontmatter.

## Archive

### Superpowers Legacy (Historic)
- `Implementation-Plans/Superpowers/` — Plans created by superpowers `writing-plans` skill before consolidation
- 3 files preserved as historical reference

---

## How to Use This Index

### Creating a new plan
1. Use template: `wiki/_Templates/Plan-Template.md` (TODO: create if missing)
2. Save to: `wiki/Planning/Implementation-Plans/YYYY-MM-DD-<feature>.md`
3. Add frontmatter with `status: active`
4. Update this index — add row to "Active Plans" table
5. Link related specs/decisions via `[[wikilinks]]`

### Marking complete
1. Update plan frontmatter: `status: completed`, set `completed: YYYY-MM-DD`
2. Move row from "Active Plans" → "Completed Plans"
3. (Optional) Write debrief: `wiki/Research/Debriefs/YYYY-MM-DD-<feature>-debrief.md`

### Finding plans
- **By date:** Browse `Implementation-Plans/` directory (sorted chronologically)
- **By topic:** Use Obsidian search or `grep "topic" wiki/Planning/`
- **By status:** Frontmatter filter via Obsidian Bases (TODO: create base)

---

## Related Indexes

- [[Decisions/Decision Index|Decision Index]] — strategic decisions with trade-offs
- [[Architecture/Specs/DOCUMENT_INDEX|Spec Document Index]] — canonical project specs (00-07)
- [[Research/Debriefs|Debriefs Folder]] — post-feature engineering notes
- [[Issues/Running Issues Log|Running Issues Log]] — active blockers and known issues
