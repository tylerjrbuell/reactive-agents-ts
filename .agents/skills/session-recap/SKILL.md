---
name: session-recap
description: Generate structured session recap and auto-extract high-confidence learnings into project memory
argument-hint: optional --auto-commit to skip approval
---

# Session Recap & Memory Extraction

## Overview

At session end, generate a recap that documents what changed, what you learned, and what should be remembered. Then extract 2-3 high-confidence memory items for approval.

This captures knowledge that would otherwise be lost, and surfaces patterns you might not explicitly notice.

## Trigger

```bash
# Manual (end of session)
.agents/skills/session-recap

# Automatic (via hook, after session completes)
# Defined in ~/.claude/settings.json onSessionEnd hook
```

## Step 1: Collect Session Data

```bash
# What changed in code
git diff HEAD~N...HEAD --stat
git log --oneline HEAD~N...HEAD
git diff HEAD~N...HEAD -- apps/docs/ .agents/

# What was modified
git status --porcelain

# Session context (if available)
# - User requests from conversation
# - Decisions made
# - Bugs encountered and fixed
# - Patterns discovered
```

## Step 2: Generate Recap Markdown

Create `.recap-{timestamp}.md`:

```markdown
# Session Recap — YYYY-MM-DD HH:MM

## Session Goal
[What the user asked you to do]

## What Changed

### Code Changes
- **docs**: Fixed X broken links in whats-new.md (Starlight absolute path issue)
- **ci**: Updated Node.js from v20 to v22 in Deploy Docs workflow
- **chore**: Removed pending 0.9.1 changesets (not releasing yet)

### Files Modified
- .agents/skills/update-docs/SKILL.md (+28 lines)
- apps/docs/src/content/docs/guides/whats-new.md (9 link fixes)
- .github/workflows/docs.yml (added Node.js setup)
- .agents/MEMORY.md (+1 entry)

### Tests/Verification
- Docs build: ✓ 66 pages, no build errors
- Link validation: local build passes
- CI status: awaiting latest run completion

## Patterns Discovered

### 1. Starlight/Astro Link Conversion Issue
**What**: Relative paths in markdown get converted to file-system paths that break the lychee link checker.
- `](./tools)` → rendered as `/guides/whats-new/tools/` ❌
- `](../features/observability)` → rendered as `/guides/features/observability/` ❌
- `](/guides/tools)` → rendered as `/guides/tools/` ✓

**Why it matters**: CI link checks fail silently without clear error messages. Took 3 iterations to find root cause.

**Solution**: Use absolute paths for all internal doc links. Update update-docs skill.

### 2. CI/Astro Node.js Version Pinning
**What**: Deploy Docs workflow was using Node.js v20, but Astro requires v22.12.0+.
**Why it matters**: CI environment differs from local dev (which had v22).
**Solution**: Pin all workflows to Node.js v22 in setup-node actions.

### 3. Changesets Auto-PR Behavior
**What**: Pending changeset files trigger automatic "Version Packages" PR creation on every push.
**Why it matters**: Noisy CI, misleading impression that release is pending.
**Solution**: Delete changeset files when not actively preparing a release.

## Memory Candidates

### HIGH CONFIDENCE → Create

**Type: feedback**
- **Name**: Starlight link patterns
- **Description**: Use absolute paths for internal doc links; relative paths cause CI link-checker failures
- **Action**: Create `.agents/MEMORY.md` entry + update update-docs skill Step 9
- **Confidence**: 🟢 HIGH (just fixed this, clear pattern)

### MEDIUM CONFIDENCE → Review

**Type: project**
- **Name**: Node.js version pinning for Astro
- **Description**: All CI workflows must use Node.js v22.12.0+ (Astro requirement)
- **Action**: Add to AGENTS.md CI section
- **Confidence**: 🟡 MEDIUM (specific to current Astro version, might change)

**Type: feedback**
- **Name**: Changeset management
- **Description**: Delete pending changeset files from `.changeset/` when not preparing a release; they trigger auto-PR creation
- **Action**: Add note to prepare-release skill
- **Confidence**: 🟡 MEDIUM (workflow-specific, not code pattern)

### LOW CONFIDENCE → Skip

- Per-session insights that are self-contained (don't apply elsewhere)
- Workarounds that should be fixed in code, not remembered
- One-off debugging that won't recur

## Step 3: Extract Memory Candidates

For each candidate, evaluate:

| Criterion | Question | Examples |
|-----------|----------|----------|
| **Reusable** | Will future sessions need this? | ✓ Link patterns ✓ Version requirements ✗ "Fixed typo in line 42" |
| **Non-obvious** | Would someone rediscover this easily? | ✓ Astro conversion behavior ✓ CI workflow drift ✗ "Use git status to see changes" |
| **Actionable** | Can the rule be applied mechanically? | ✓ "Use absolute paths" ✓ "Pin to v22" ✗ "Be careful with links" |
| **Durable** | Will this still matter in 6 months? | ✓ Link patterns ✓ Type requirements ✗ "Changesets bugged in Apr" |

Score 3+/4: **HIGH confidence** → auto-create memory file  
Score 2/4: **MEDIUM confidence** → present for approval  
Score <2/4: **LOW confidence** → skip

## Step 4: Memory File Creation

For each HIGH-confidence candidate, create file at:

```
~/.claude/projects/-home-tylerbuell-Documents-AIProjects-reactive-agents-ts/memory/
  feedback_<topic>.md
  project_<topic>.md
  reference_<topic>.md
```

**Format for feedback**:
```markdown
---
name: [topic]
description: [one-line, use for future relevance filtering]
type: feedback
---

[Rule statement]

**Why:** [Reason + past incident/discovered issue]

**How to apply:** [When/where this kicks in]
```

## Step 5: Update .agents/MEMORY.md Index

Add one-line pointer in appropriate section:

```markdown
## Feedback
- [Starlight link patterns](feedback_starlight_link_patterns.md) — use absolute paths for internal doc links; relative paths cause CI link-checker failures
```

Keep under 150 characters so index stays readable (max ~200 lines total).

## Step 6: Approval & Commit

Present candidates for review:

```
3 Memory Candidates Extracted

[HIGH] ✅ feedback_starlight_link_patterns.md
  Use absolute paths for internal doc links; relative paths cause CI link-checker failures
  [Create] [Skip]

[MEDIUM] 🟡 project_astro_node_version.md
  All CI workflows must use Node.js v22.12.0+ (Astro requirement)
  [Create] [Review first] [Skip]

[MEDIUM] 🟡 feedback_changeset_workflow.md
  Delete pending changeset files when not preparing a release
  [Create] [Review first] [Skip]
```

User decides:
- **[Create]**: Auto-commit memory files and update index
- **[Review first]**: Show full markdown, let user edit before committing
- **[Skip]**: Don't create (but show in git diff for manual review later)

## Step 7: Commit with Recap

```bash
git add .agents/MEMORY.md feedback_*.md project_*.md .recap-*.md
git commit -m "chore: session recap + extracted learnings [auto-memory]"
```

Include recap in commit (or as GitHub Actions annotation) for future reference.

## Quick Reference: Memory Types

| Type | Purpose | Examples |
|------|---------|----------|
| **feedback** | How to approach work (what to do/avoid) | "Use absolute paths", "Never skip hooks", "Commit before branching" |
| **project** | Current state, milestones, constraints | "v0.9.0 shipped Apr 3", "Node.js v22 required", "180 tests across 42 files" |
| **reference** | Where to find info in external systems | "Bugs tracked in Linear project INGEST", "Grafana board is grafana.internal/d/api-latency" |
| **user** | About the user's role/preferences | "User is data scientist", "Prefers terse responses", "10 years Go experience" |

## Implementation: Hook Integration

In `.claude/settings.json`:

```json
{
  "hooks": {
    "onSessionEnd": {
      "name": "auto-recap",
      "command": ".agents/skills/session-recap/generate.sh",
      "env": {
        "PROJECT_ROOT": "${PROJECT_PATH}",
        "SESSION_START": "${SESSION_START_TIME}"
      }
    }
  }
}
```

Script (`generate.sh`) would:
1. Collect git changes since session start
2. Parse conversation context
3. Generate recap markdown
4. Extract candidates
5. Present for approval (interactive prompt or GitHub annotation)
6. Commit approved items

## Notes

- Recap is **not** a commit message — it's documentation for future reference
- Memory extraction is **opt-in** — user always decides what gets remembered
- Recap files stay in git history for audit trail
- If extraction takes >30s, skip approval step and commit all HIGH-confidence items only
