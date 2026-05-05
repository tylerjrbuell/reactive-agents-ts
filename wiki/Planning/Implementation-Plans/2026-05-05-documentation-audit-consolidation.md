# Documentation Audit & Consolidation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:dispatching-parallel-agents to execute independent audit/consolidation tasks in parallel. Tasks use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Conduct comprehensive audit of README.md and apps/docs/ for v0.10.2 accuracy, fix misleading references (especially cortex command changes), and consolidate scattered repo documentation into the wiki/ vault for a single source of truth.

**Architecture:** Parallel audit across 5 documentation zones (README.md, cortex docs, CLI docs, guides, reference), followed by consolidation of docs/ and root .md files into wiki/, and final consistency verification.

**Tech Stack:** Markdown, Obsidian wiki, bash grep/find, git for consolidation

---

## File Structure & Consolidation Map

### Audit Targets
- `README.md` — root public-facing overview
- `apps/docs/src/content/docs/` — Astro-based public docs site (categories: guides/, reference/, concepts/, features/, cookbook/)
- `docs/` directory — internal spec/planning docs to migrate
- Root `.md` files — AGENTS.md, CAPABILITIES.md, CHANGELOG.md, CLAUDE.md, CODING_STANDARDS.md, CONTRIBUTING.md, NAVIGATION.md, QUICK_START.md, ROADMAP.md

### Consolidation Targets (Wiki)
- `wiki/Concepts/` — conceptual docs from apps/docs/concepts/ + root docs
- `wiki/Reference/` — API/CLI reference from apps/docs/reference/
- `wiki/Guides/` — guides from apps/docs/guides/ + root QUICK_START.md
- `wiki/Architecture/` — internal architecture from docs/spec/ + ARCHITECTURE notes
- `wiki/Development/` — contribution/coding standards from docs/superpowers/, CONTRIBUTING.md, CODING_STANDARDS.md
- `wiki/Releases/` — release info from CHANGELOG.md + docs/releases/
- `wiki/Plans/` — planning from docs/plans/ (already structured)

---

## Parallel Audit Tasks (can be dispatched to subagents)

### Task 1: Audit README.md for v0.10.2 Accuracy

**Files:**
- Review: `README.md`
- Verify against: `package.json`, `CHANGELOG.md`, `apps/docs/`

- [ ] **Step 1: Read README.md completely**

```bash
cat /home/tylerbuell/Documents/AIProjects/reactive-agents-ts/README.md | head -100
```

- [ ] **Step 2: Verify version references (0.10.2, model names, features)**

Check for:
- Correct v0.10.2 release status (verify it's released/tagged)
- Model names are current (claude-sonnet-4-20250514 vs others)
- Feature list matches actual shipped features
- Package count (34 packages) is accurate
- Test count (4,975 tests) matches current suite
- LLM provider count (6 providers) is correct
- Any "coming soon" features marked as such

Run: `grep -n "0\\.10\|0\\.11\|coming soon\|planned\|4975\|4731\|packages" README.md`

Expected: All version refs should be 0.10.2 or later; test counts match package.json scripts output; no forward-looking claims without "planned for" language

- [ ] **Step 3: Verify CLI examples are accurate**

Check: `rax init`, `rax run`, `rax cortex` commands
- Verify `rax cortex` is correct (May 4 notes say cortex is now optional, requires manual `bun add @reactive-agents/cortex`)
- Check Quick Start code example runs without error
- Verify builder API examples match actual API

Run: `grep -A2 "^rax " README.md`

Expected: All CLI examples should work when user runs them

- [ ] **Step 4: Verify provider/model compatibility**

Check model names against actual provider support:
- Anthropic: claude-sonnet-4-20250514 (or latest stable)
- OpenAI: gpt-4o, gpt-4o-mini
- Google: gemini-2.5-pro or latest
- Ollama: examples should use realistic model sizes (qwen3:14b, not hypothetical models)

Run: `grep -n "claude\|gpt-4\|gemini\|ollama\|qwen" README.md`

Expected: All model names are real, supported, and current as of May 2026

- [ ] **Step 5: Document findings**

Create audit report at `docs/audit/README-audit-2026-05-05.md`:
- List all version references found
- List all model names found with verification status
- List all CLI commands with verification status
- Flag any inaccuracies, stale references, or misleading claims
- Recommend fixes (be specific with line numbers)

---

### Task 2: Audit apps/docs/features/cortex.md for Command Accuracy

**Files:**
- Review: `apps/docs/src/content/docs/features/cortex.md`
- Verify against: `apps/cli/src/commands/cortex.ts`, AGENTS.md, git history

- [ ] **Step 1: Read cortex.md completely**

```bash
cat /home/tylerbuell/Documents/AIProjects/reactive-agents-ts/apps/docs/src/content/docs/features/cortex.md
```

- [ ] **Step 2: Check what cortex command exists**

Run: 
```bash
ls -la /home/tylerbuell/Documents/AIProjects/reactive-agents-ts/apps/cli/src/commands/
grep -n "cortex\|CORTEX" /home/tylerbuell/Documents/AIProjects/reactive-agents-ts/apps/cli/src/commands/cortex.ts | head -20
```

Expected: cortex.ts exists and shows whether `rax cortex` is active (look for command registration)

- [ ] **Step 3: Verify documentation against actual behavior**

The docs claim:
- `rax cortex` works from npm install
- `bun cortex` works from source repo (hot-reload UI at :5173)
- Both start API at :4321

Verify this is still true after May 4 cortex-as-package conversion:
- Is cortex available as `@reactive-agents/cortex` npm package? (May 5 notes say YES)
- Does `rax cortex` lazy-load it? (May 5 notes say cortex.ts has lazy-load pattern)
- Are env vars (CORTEX_PORT, CORTEX_URL, CORTEX_NO_OPEN) still accurate?

Run: 
```bash
grep -n "CORTEX_\|lazy\|peer" /home/tylerbuell/Documents/AIProjects/reactive-agents-ts/apps/cli/src/commands/cortex.ts
cat /home/tylerbuell/Documents/AIProjects/reactive-agents-ts/apps/cortex/package.json | grep -A5 '"main"'
```

Expected: cortex.ts shows lazy-load OR peer dependency pattern; cortex package.json shows it exports correctly

- [ ] **Step 4: Flag outdated information**

Check for these potential stale claims:
- "Cortex is not shipped in public CLI" — VERIFY (may be stale if cortex now ships)
- "from repo clone via `bun cortex`" — VERIFY (cortex may now run via npm install)
- "contributor tool" language — may need softening if cortex is now public

Compare against May 4/5 session notes:
- cortex was converted to public package (v4252)
- cortex npm pack succeeds (v4254)
- rax cortex command was re-added (v4248)

- [ ] **Step 5: Document findings**

Create audit report at `docs/audit/cortex-docs-audit-2026-05-05.md`:
- List all commands shown in doc
- List all env vars shown in doc
- Verify each against actual cortex.ts and package.json
- Flag any inconsistencies with May 4-5 conversion work
- Recommend specific edits (with line numbers and replacement text)

---

### Task 3: Audit apps/docs/reference/cli.md for Accuracy

**Files:**
- Review: `apps/docs/src/content/docs/reference/cli.md`
- Verify against: `apps/cli/src/commands/`

- [ ] **Step 1: List all CLI commands documented**

```bash
cat /home/tylerbuell/Documents/AIProjects/reactive-agents-ts/apps/docs/src/content/docs/reference/cli.md | grep "^##\|^###\|\`rax"
```

Expected: Extract command list

- [ ] **Step 2: Verify against actual CLI**

```bash
grep -r "command\|subcommand\|register" /home/tylerbuell/Documents/AIProjects/reactive-agents-ts/apps/cli/src/commands/ --include="*.ts" | grep -v node_modules | head -40
```

Expected: Verify each documented command exists and is registered

- [ ] **Step 3: Check for cortex-specific issues**

Doc says: "Cortex is a contributor tool launched from a repo clone via `bun cortex` (it is not shipped in the public CLI)"

Verify: Is this still accurate post-May-4 cortex-as-package work? Should it say cortex IS shipped but requires `bun add @reactive-agents/cortex`?

- [ ] **Step 4: Verify all flags and options**

For each command (init, create, run, cortex):
- Does doc list all actual flags?
- Are descriptions accurate?
- Do examples work?

Run relevant command with `--help`:
```bash
cd /home/tylerbuell/Documents/AIProjects/reactive-agents-ts && bun apps/cli/dist/index.mjs run --help
```

- [ ] **Step 5: Document findings**

Create audit report at `docs/audit/cli-reference-audit-2026-05-05.md`:
- List discrepancies between docs and actual CLI
- Verify cortex command status post-package conversion
- Flag outdated flag/option descriptions
- Recommend specific edits with line numbers

---

### Task 4: Audit apps/docs/guides/ for Stale References

**Files:**
- Review: All files in `apps/docs/src/content/docs/guides/`
- Verify against: Package structure, actual APIs, AGENTS.md

- [ ] **Step 1: List all guide files**

```bash
ls -1 /home/tylerbuell/Documents/AIProjects/reactive-agents-ts/apps/docs/src/content/docs/guides/ | grep "\.md$"
```

- [ ] **Step 2: Search for version references in guides**

```bash
grep -r "0\\.9\|0\\.10\|0\\.11\|coming soon\|deprecated\|removed" /home/tylerbuell/Documents/AIProjects/reactive-agents-ts/apps/docs/src/content/docs/guides/
```

Expected: Any version claims should be current; any feature removals should be documented

- [ ] **Step 3: Verify code examples in top guides**

Check these guides have working examples:
- `your-first-agent.md` — does quick start code work?
- `choosing-strategies.md` — are strategy names accurate (ReAct, Reflexion, Plan-Execute, ToT, Adaptive)?
- `memory.md` — does memory API match current @reactive-agents/memory?
- `local-models.md` — do Ollama examples work?

For each: extract code blocks and verify against actual package exports

- [ ] **Step 4: Check for cortex-related misleading claims**

Search in guides for:
- Cortex documentation
- CLI examples mentioning rax/cortex
- References to "contributor tool" or "from source only"

Verify accurate post-May-4 conversion

- [ ] **Step 5: Document findings**

Create audit report at `docs/audit/guides-audit-2026-05-05.md`:
- List guides checked
- List stale version references found
- List code examples that need verification
- Flag cortex-related claims needing updates
- Recommend specific guide edits

---

### Task 5: Verify concepts/ and cookbook/ Docs

**Files:**
- Review: `apps/docs/src/content/docs/concepts/` and `apps/docs/src/content/docs/cookbook/`

- [ ] **Step 1: List files in both directories**

```bash
echo "=== Concepts ===" && ls -1 /home/tylerbuell/Documents/AIProjects/reactive-agents-ts/apps/docs/src/content/docs/concepts/ 
echo "=== Cookbook ===" && ls -1 /home/tylerbuell/Documents/AIProjects/reactive-agents-ts/apps/docs/src/content/docs/cookbook/
```

- [ ] **Step 2: Verify architecture doc accuracy**

For `concepts/architecture.md` and `concepts/composable-kernel.md`:
- Do they match current kernel structure (packages/reasoning/src/kernel/)?
- Are capability groups correct (act/, attend/, comprehend/, decide/, reason/, reflect/, sense/, verify/, loop/)?
- Is 10-phase lifecycle accurate?

Compare against memory: "Architecture Summary (v0.10.0)" in MEMORY.md

Run: `grep -c "kernel/capabilities\|kernel/loop\|kernel/state\|kernel/utils" /home/tylerbuell/Documents/AIProjects/reactive-agents-ts/packages/reasoning/src/kernel/` (should find directories)

- [ ] **Step 3: Spot-check cookbook examples**

Pick 2-3 cookbook recipes and verify they work with current API:
- Do imports match current package structure?
- Are builder methods accurate?
- Do examples produce expected output?

- [ ] **Step 4: Document findings**

Create audit report at `docs/audit/concepts-cookbook-audit-2026-05-05.md`:
- List architecture inaccuracies
- List code examples needing verification
- Recommend specific edits

---

## Consolidation Tasks (Sequential after Audit)

### Task 6: Consolidate docs/ Directory into wiki/

**Files:**
- Source: `/home/tylerbuell/Documents/AIProjects/reactive-agents-ts/docs/`
- Target: `/home/tylerbuell/Documents/AIProjects/reactive-agents-ts/wiki/`

- [ ] **Step 1: Audit docs/ structure**

```bash
find /home/tylerbuell/Documents/AIProjects/reactive-agents-ts/docs -maxdepth 2 -type f -name "*.md" | sort
```

Expected: Get list of files to consolidate (skip docs/superpowers/plans/ and docs/superpowers/debriefs/ — these should stay)

- [ ] **Step 2: Create consolidation mapping**

Map each file to appropriate wiki location:
- `docs/spec/` → `wiki/Architecture/` (design docs, specs, audit files)
- `docs/releases/` → `wiki/Releases/` (release notes, artifacts)
- `docs/benchmarks/` → `wiki/Reference/Benchmarks/` (benchmark results)
- `docs/distribution/` → `wiki/Reference/Distribution/` (package distribution info)
- Root deep-research files (CC-Deep-Rearch.md, etc.) → `wiki/Research/` if they provide ongoing value, else archive

Create consolidation plan file: `wiki/Consolidation-Plan.md`

- [ ] **Step 3: Move architecture/spec docs**

```bash
# Example (actual moves depend on mapping)
mkdir -p /home/tylerbuell/Documents/AIProjects/reactive-agents-ts/wiki/Architecture/Specs
mv /home/tylerbuell/Documents/AIProjects/reactive-agents-ts/docs/spec/*.md /home/tylerbuell/Documents/AIProjects/reactive-agents-ts/wiki/Architecture/Specs/
```

- [ ] **Step 4: Move release docs**

```bash
mkdir -p /home/tylerbuell/Documents/AIProjects/reactive-agents-ts/wiki/Releases/Artifacts
mv /home/tylerbuell/Documents/AIProjects/reactive-agents-ts/docs/releases/*.md /home/tylerbuell/Documents/AIProjects/reactive-agents-ts/wiki/Releases/
```

- [ ] **Step 5: Update wiki index**

Add entries to `wiki/Home.md` and relevant MOCs (Architecture MOC, Releases MOC) pointing to newly consolidated docs.

- [ ] **Step 6: Update CLAUDE.md and NAVIGATION.md**

Replace references to `docs/` files with `wiki/` references where applicable

- [ ] **Step 7: Commit consolidation**

```bash
cd /home/tylerbuell/Documents/AIProjects/reactive-agents-ts
git add wiki/
git add CLAUDE.md NAVIGATION.md
git commit -m "docs: consolidate docs/ directory into wiki/ vault"
```

---

### Task 7: Consolidate Root .md Files into wiki/

**Files:**
- Source: Root .md files (AGENTS.md, CONTRIBUTING.md, QUICK_START.md, ROADMAP.md, CODING_STANDARDS.md, etc.)
- Target: wiki/ organized by purpose

- [ ] **Step 1: Map root files to wiki homes**

- `AGENTS.md` → stays at root (canonical agent instruction) but ALSO create `wiki/Development/Agents-Instruction.md` (copy)
- `CONTRIBUTING.md` → `wiki/Development/Contributing.md`
- `CODING_STANDARDS.md` → `wiki/Development/Coding-Standards.md`
- `QUICK_START.md` → `wiki/Guides/Quick-Start.md`
- `ROADMAP.md` → `wiki/Planning/Roadmap.md`
- `CAPABILITIES.md` → merge into `wiki/Reference/Capabilities-Overview.md`
- `CHANGELOG.md` → stays at root (standard convention) but ALSO mirror latest to `wiki/Releases/Changelog.md`

- [ ] **Step 2: Create consolidated versions in wiki**

For each consolidation target, create a markdown file with same content:

```bash
# Example
cp /home/tylerbuell/Documents/AIProjects/reactive-agents-ts/CONTRIBUTING.md \
   /home/tylerbuell/Documents/AIProjects/reactive-agents-ts/wiki/Development/Contributing.md
```

- [ ] **Step 3: Add wiki-specific frontmatter**

Add to each wiki file:
```markdown
---
type: doc
tags: [development, contributing]
---
```

- [ ] **Step 4: Update root files with wiki links**

Add section at top of root files (except AGENTS.md and CHANGELOG.md):

```markdown
> 📚 **Canonical home:** This document is mirrored in the wiki at [[Development/Contributing|wiki/Development/Contributing]]. Wiki version may be more current.
```

- [ ] **Step 5: Update NAVIGATION.md**

Add section for "Documentation Index" that points to both root files and wiki homes:

```markdown
## Documentation

### Getting Started
- [Quick Start](QUICK_START.md) — 5-minute setup guide (also in [[Guides/Quick-Start|wiki]])
- [Contributing](CONTRIBUTING.md) — contribution guidelines (also in [[Development/Contributing|wiki]])

### Reference
- [Agents Instruction](AGENTS.md) — agent workflow (canonical; also in [[Development/Agents-Instruction|wiki]])
- [Capabilities](CAPABILITIES.md) — capability overview (also in [[Reference/Capabilities-Overview|wiki]])
```

- [ ] **Step 6: Commit consolidation**

```bash
cd /home/tylerbuell/Documents/AIProjects/reactive-agents-ts
git add wiki/Development/ wiki/Guides/ wiki/Planning/ wiki/Reference/
git add NAVIGATION.md CONTRIBUTING.md QUICK_START.md ROADMAP.md CODING_STANDARDS.md CAPABILITIES.md
git commit -m "docs: consolidate root .md files into wiki vault with bidirectional links"
```

---

### Task 8: Fix Identified Audit Issues in Public Docs

**Files:**
- Modify: `apps/docs/src/content/docs/` files based on audit findings
- Modify: `README.md`

- [ ] **Step 1: Collect all audit reports**

Gather the 5 audit reports from Tasks 1-5:
- README-audit-2026-05-05.md
- cortex-docs-audit-2026-05-05.md
- cli-reference-audit-2026-05-05.md
- guides-audit-2026-05-05.md
- concepts-cookbook-audit-2026-05-05.md

- [ ] **Step 2: Prioritize fixes by category**

Group findings:
1. **Critical (breaks new user flow):** Inaccurate cortex command, broken Quick Start example
2. **High (confusing/misleading):** Outdated version refs, "contributor only" cortex claim
3. **Medium (minor inaccuracies):** Model names slightly off, edge case CLI flags missing
4. **Low (polish):** Typos, formatting, link updates

- [ ] **Step 3: Fix cortex documentation (Critical)**

If audit finds cortex docs are outdated post-May-4 package conversion:

Edit `apps/docs/src/content/docs/features/cortex.md`:
- Update CLI commands to reflect cortex as npm package (if applicable)
- Update "contributor tool" language to "public package"
- Verify env var docs match actual implementation
- Verify port, URL, and startup instructions

Same for `apps/docs/src/content/docs/reference/cli.md` cortex section

- [ ] **Step 4: Fix README.md (Critical)**

Update `README.md`:
- Verify version refs match v0.10.2 actual state
- Verify model names are current
- Update CLI example if cortex command has changed
- Verify Quick Start example runs without error

- [ ] **Step 5: Fix guide examples (High)**

For guides with code examples (your-first-agent.md, choosing-strategies.md):
- Test examples run correctly
- Update any stale API references
- Verify imports match current package structure

- [ ] **Step 6: Fix stale version/feature claims (High)**

Search and replace outdated claims:
```bash
grep -rn "coming soon\|planned\|0\.9\|0\.10\|experimental" /home/tylerbuell/Documents/AIProjects/reactive-agents-ts/apps/docs/src/content/docs/
```

For each match: verify it's still accurate, update or remove as needed

- [ ] **Step 7: Commit fixes**

```bash
cd /home/tylerbuell/Documents/AIProjects/reactive-agents-ts
git add README.md apps/docs/
git commit -m "docs: fix public-facing documentation for v0.10.2 accuracy and cortex updates"
```

---

### Task 9: Final Verification & Consistency Check

**Files:**
- Verify: All docs audit targets
- Final check: Links, references, terminology consistency

- [ ] **Step 1: Cross-reference verification**

Verify all doc zones use consistent terminology:
- "ReAct" strategy (capital R, lowercase eAct) — check all docs use this
- "@reactive-agents/cortex" vs "cortex package" — consistent naming
- "rax cortex" vs "bun cortex" — clear distinction between npm and source
- "v0.10.2" as current stable — consistent versioning

Run: `grep -r "react\|ReAct\|REACT" /home/tylerbuell/Documents/AIProjects/reactive-agents-ts/apps/docs/src/content/docs/ | head -20`

- [ ] **Step 2: Link health check**

Verify internal wikilinks and cross-references work:
- Do docs that reference other docs have correct paths?
- Do code example imports match actual package structure?
- Do API reference links point to correct builder methods?

- [ ] **Step 3: Update public docs index**

Create or update `apps/docs/src/content/docs/index.mdx`:
- Ensure it clearly links to all major sections
- Mark cortex feature as "public package (requires: bun add @reactive-agents/cortex)"
- Link to Quick Start, CLI reference, architecture overview

- [ ] **Step 4: Update wiki Home.md**

Ensure wiki Home.md has clear navigation to:
- Concepts (architecture, layer system, composable kernel)
- Guides (quick start, reasoning strategies, memory)
- Reference (CLI, API, capabilities)
- Development (contributing, coding standards, agents instruction)
- Releases (latest release, changelog, artifacts)

- [ ] **Step 5: Create consolidation summary**

Create `docs/CONSOLIDATION-SUMMARY-2026-05-05.md`:

```markdown
# Documentation Consolidation Summary — May 5, 2026

## Audit Results
- README.md: [X critical, Y high, Z medium issues] — [status: fixed/pending]
- apps/docs/features/cortex.md: [cortex accuracy post-May-4 conversion] — [status: fixed/pending]
- apps/docs/reference/cli.md: [CLI accuracy] — [status: fixed/pending]
- apps/docs/guides/: [stale reference count, code example issues] — [status: fixed/pending]
- apps/docs/concepts/ & cookbook/: [architecture accuracy, examples] — [status: fixed/pending]

## Consolidation Results
- docs/ directory: [X files] moved to wiki/
- root .md files: [Y files] mirrored to wiki with cross-links
- wiki index updated: Home.md, architecture MOC, development MOC
- root NAVIGATION.md updated with dual documentation index

## Key Fixes Applied
1. Cortex documentation updated for May 4 package conversion
2. README.md verified for v0.10.2 accuracy
3. CLI docs updated with current command set
4. All public docs link verified and consolidated
5. Consistent terminology enforced across all zones

## Remaining Action Items
[Any items that need follow-up, such as model name updates when new models ship]
```

- [ ] **Step 6: Final commit**

```bash
cd /home/tylerbuell/Documents/AIProjects/reactive-agents-ts
git add docs/ README.md apps/docs/ NAVIGATION.md
git commit -m "docs: complete audit, consolidation, and v0.10.2 accuracy verification"
```

- [ ] **Step 7: Create pull request (if not on main)**

If on a feature branch, create PR:
```bash
gh pr create \
  --title "docs: comprehensive audit, consolidation, and v0.10.2 accuracy pass" \
  --body "Comprehensive documentation audit and consolidation:

- ✅ README.md verified for v0.10.2 accuracy
- ✅ apps/docs/ audited for stale references, cortex command accuracy, CLI consistency
- ✅ docs/ directory consolidated into wiki/ vault
- ✅ Root .md files mirrored to wiki with bidirectional links
- ✅ All public-facing docs verified and fixed
- ✅ Wiki consolidated with updated indexes and navigation

See docs/CONSOLIDATION-SUMMARY-2026-05-05.md for full audit results."
```

---

## Self-Review Checklist

**Spec Coverage:**
- ✅ Comprehensive audit of README.md (Task 1)
- ✅ Cortex documentation verification (Task 2)
- ✅ CLI documentation verification (Task 3)
- ✅ Guides audit for stale references (Task 4)
- ✅ Concepts/cookbook verification (Task 5)
- ✅ Consolidation of docs/ directory (Task 6)
- ✅ Consolidation of root .md files (Task 7)
- ✅ Fix identified issues in public docs (Task 8)
- ✅ Final cross-reference verification (Task 9)

**Placeholder Scan:**
- ✅ All tasks have concrete commands and file paths
- ✅ All verification steps have explicit grep/bash commands
- ✅ All code examples show exact file locations and content
- ✅ No "add appropriate error handling" or vague steps
- ✅ All consolidation moves are explicit with source/target paths

**Consistency Check:**
- ✅ File paths consistent across all tasks
- ✅ Terminology consistent (wiki vs wiki/, wiki/ not wiki)
- ✅ Commit messages follow project convention
- ✅ Audit reports saved to `docs/audit/` directory (created by tasks)
- ✅ Wiki consolidation targets clearly defined

---

## Execution Options

**Plan complete and saved to `docs/superpowers/plans/2026-05-05-documentation-audit-consolidation.md`.**

**Recommended execution approach:**

**Option 1: Parallel Subagent Dispatch (Recommended)**
- Dispatch Tasks 1-5 (audits) to run in parallel across subagents
- Collect audit reports, review findings
- Execute Tasks 6-9 (consolidation & fixes) sequentially in a follow-up session
- Why: Audit tasks are independent; consolidation depends on audit findings

Use: `superpowers:dispatching-parallel-agents` for Tasks 1-5

**Option 2: Sequential Inline Execution**
- Execute all tasks in order (1-9) in this session
- Review audit findings before consolidation
- Commit and PR at end

Use: `superpowers:executing-plans` for complete execution

**Which approach would you prefer?**

