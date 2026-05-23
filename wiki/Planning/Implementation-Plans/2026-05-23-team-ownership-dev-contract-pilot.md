---
type: implementation-plan
status: active
created: 2026-05-23
expires: 2026-06-15
tags: [dev-workflow, multi-agent, extreme-ownership, pilot, ablation-gated]
related:
  - "[[2026-05-18-agentic-team-ownership-concepts]]"
  - "[[01-RESEARCH-DISCIPLINE]]"
  - "[[05-DESIGN-NORTH-STAR]]"
---

# Team-Ownership Dev Contract — Ablation Pilot

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Empirically determine whether a team-ownership dev workflow contract (specialized wardens + MissionBrief/UpwardReport schemas + deterministic dispatcher FSM) amplifies productivity and quality on this codebase, OR whether it adds bureaucracy without lift — then canonicalize OR revert based on evidence by **2026-06-15**.

**Architecture:** Minimum-viable surface — **one** warden (`kernel-warden`) plus two schema skills (`mission-brief`, `upward-report`) plus a dispatcher FSM table in AGENTS.md, all marked `PILOT` with a hard expiry. The pilot routes all kernel/* edits through the warden during the trial window, logs structured outcomes, and is evaluated against pre-stated kill / lift criteria. If lift confirmed, Phase 2 expands the roster; if not, one revert commit removes the entire scaffold.

**Tech Stack:** Markdown agent / skill definitions in `.claude/`, AGENTS.md additive section, `wiki/Research/Pilots/` for charter + log, `rtk gain --history` for token measurement, `rtk git log --oneline` for first-attempt-completion measurement.

**Why this is the right shape (do not skip reading):**
- Design spec [[2026-05-18-agentic-team-ownership-concepts]] §Conflict-Warning-2: *"Mission-intent propagation is an untested assumption. Any intent plumbing must be ablation-gated with a pre-stated rule (≥2 models, ≥3pp lift & ≤15% token overhead → default-on; else opt-in; else remove — the M3 precedent) before going default-on."*
- North Star §9 + the "scaffold without callers" anti-pattern (codified 2026-05-23): canonicalizing a 10-agent workflow without empirical lift IS the failure mode the project just codified against.
- M3 REWORK precedent (May 12, commit `051c22be`): shipping mechanisms then proving them failed; the project now requires ablation gates before default-on.
- The pilot's three load-bearing constraints — **measurable kill criteria, forcing function, hard expiry** — exist so the pilot itself doesn't become the very anti-pattern it tests.

---

## File Structure

| Path | Purpose | Owner |
|---|---|---|
| `wiki/Planning/Implementation-Plans/2026-05-23-team-ownership-dev-contract-pilot.md` | This plan | Created |
| `wiki/Research/Pilots/2026-05-23-team-ownership-dev-contract/README.md` | Pilot charter: scope, success / kill criteria, evaluation rules, expiry | Phase 0 |
| `wiki/Research/Pilots/2026-05-23-team-ownership-dev-contract/log.md` | Append-only structured log of each kernel/* task routed through warden vs main | Phase 0 (empty), Phase 1 (populated) |
| `.claude/skills/mission-brief/SKILL.md` | MissionBrief YAML schema + when to invoke | Phase 0 |
| `.claude/skills/upward-report/SKILL.md` | UpwardReport schema + tail parsing rules | Phase 0 |
| `.claude/agents/kernel-warden.md` | Bounded warden: `packages/reasoning/src/kernel/**` authority, domain primer, refuses out-of-scope | Phase 0 |
| `AGENTS.md` | Add `Team-Ownership Dev Contract (PILOT)` section: dispatcher FSM table + forcing-function rule + expiry banner | Phase 0 |

**Total scaffold:** 1 plan doc + 2 wiki pilot files + 2 skill files + 1 agent file + 1 AGENTS.md section = **7 files added or touched**. Cleanup on kill = one revert commit.

---

## Pre-stated Success / Kill Criteria

These MUST be set **before** Phase 1 begins. They cannot be tightened or loosened mid-pilot.

### Forcing function (mandatory routing rule, written into AGENTS.md PILOT section)

> Between **2026-05-23** and **2026-06-15**, any edit whose primary scope is `packages/reasoning/src/kernel/**` MUST be routed through `kernel-warden` via Agent dispatch. Main-thread direct edits to kernel files during the pilot window violate the contract and disqualify the task from pilot data. The single exception: hot-fix to red CI on `main`, logged with `bypass-reason` in `log.md`.

### Metrics (measurable without new instrumentation)

| Metric | Source | Baseline | Pilot target |
|---|---|---|---|
| First-attempt task completion rate | `rtk git log --oneline` — count commits per logical kernel/* task; "first-attempt" = task closed in ≤1 commit (excludes the followup fix commit pattern) | Last 10 kernel/* tasks pre-pilot (compute on day 1 of Phase 1) | ≥ baseline + 3pp |
| Token cost per task | `rtk gain --history` deltas per logical task | Same 10 historical tasks | ≤ 1.15 × baseline |
| Re-spawn count | Manual count of Agent tool calls per logical task, logged in `log.md` | n/a (new measurement) | ≤ 1.5 avg |
| Regressions caught pre-commit | Did `kernel-warden`'s domain primer prevent a known failure mode (loop-detector streak rule, terminate-as-single-owner, M3 REWORK awareness)? Logged as binary per task. | n/a | ≥ 1 documented catch over pilot window |

### Lift threshold (canonicalize at Phase 2 if AND-of):

- First-attempt completion rate ≥ baseline + 3pp
- Token overhead ≤ 15%
- Avg re-spawn count ≤ 1.5
- At least 1 documented regression-catch attributable to warden domain primer

### Kill threshold (revert pilot, REWORK verdict, if ANY of):

- First-attempt completion rate < baseline − 3pp (worse than no contract)
- Token overhead > 30%
- Avg re-spawn count > 2.5
- < 10 pilot tasks logged by 2026-06-15 (insufficient data → kill by default, no "let me collect a bit more")
- User (Tyler) declares pilot adds net friction in `log.md` summary entry

### Inconclusive (default behavior on 2026-06-15)

If neither lift nor kill threshold is met cleanly → **kill by default**. Default-revert mirrors M3 REWORK precedent: untested-or-marginal mechanisms do not earn default status. Phase 2 canonicalization requires affirmative evidence.

---

## Phase 0: Scaffold (executable now, this session)

### Task 0.1: Pilot charter

**Files:**
- Create: `wiki/Research/Pilots/2026-05-23-team-ownership-dev-contract/README.md`

- [ ] **Step 1: Write the charter**

```markdown
---
type: pilot-charter
status: active
created: 2026-05-23
expires: 2026-06-15
related:
  - "[[2026-05-23-team-ownership-dev-contract-pilot]]"
  - "[[2026-05-18-agentic-team-ownership-concepts]]"
---

# Pilot Charter — Team-Ownership Dev Contract

**Window:** 2026-05-23 → 2026-06-15 (3 weeks, hard expiry).
**Scope:** Edits whose primary scope is `packages/reasoning/src/kernel/**`.
**Hypothesis:** A bounded `kernel-warden` agent with a domain primer + MissionBrief input + UpwardReport output produces measurably better outcomes than main-thread direct edits.

## Success / kill criteria
See [[2026-05-23-team-ownership-dev-contract-pilot#Pre-stated-Success-Kill-Criteria|the plan §Pre-stated Success / Kill Criteria]]. Reproduced here so the charter is self-sufficient.

### Forcing function
Between 2026-05-23 and 2026-06-15, any edit whose primary scope is `packages/reasoning/src/kernel/**` MUST be routed through `kernel-warden` via Agent dispatch. Main-thread direct edits during the pilot window violate the contract and disqualify the task from pilot data. Single exception: hot-fix to red CI on `main`, logged with `bypass-reason` in `log.md`.

### Lift threshold (canonicalize at Phase 2 if AND-of)
- First-attempt completion rate ≥ baseline + 3pp
- Token overhead ≤ 15%
- Avg re-spawn count ≤ 1.5
- ≥ 1 documented regression-catch attributable to warden domain primer

### Kill threshold (REWORK if ANY of)
- First-attempt completion rate < baseline − 3pp
- Token overhead > 30%
- Avg re-spawn count > 2.5
- < 10 pilot tasks logged by 2026-06-15
- Tyler declares net friction in `log.md` summary entry

### Default on 2026-06-15
Inconclusive → kill. Affirmative evidence required for canonicalization. Mirrors M3 REWORK precedent.

## Out of scope (do not measure)
- Performance on non-kernel packages
- Multiple wardens (Phase 2 only)
- Runtime multi-agent execution (separate concern, see [[2026-05-18-agentic-team-ownership-concepts]])

## Evaluation date
2026-06-15. Write evaluation entry to `log.md` summary section. Decide canonicalize / revert. No extensions.
```

- [ ] **Step 2: Verify file written and frontmatter valid**

Run: `rtk cat wiki/Research/Pilots/2026-05-23-team-ownership-dev-contract/README.md | head -20`
Expected: `type: pilot-charter`, `expires: 2026-06-15` present.

### Task 0.2: Pilot log (empty stub)

**Files:**
- Create: `wiki/Research/Pilots/2026-05-23-team-ownership-dev-contract/log.md`

- [ ] **Step 1: Write the log stub**

```markdown
---
type: pilot-log
status: active
created: 2026-05-23
---

# Pilot Log — Team-Ownership Dev Contract

> Append-only. One block per logical kernel/* task. Format below. Summary section appended on 2026-06-15.

## Entry format

\`\`\`yaml
- task: <short slug>
  date: YYYY-MM-DD
  routed: warden | main | bypass
  bypass-reason: <if bypass>
  commits: <count>                       # first-attempt = 1
  agent-spawns: <count>                  # for re-spawn metric
  tokens-est: <number from rtk gain>
  regression-prevented: <description | none>
  notes: <one line>
\`\`\`

## Baseline (computed 2026-05-23)

> Run on day 1 of Phase 1. Compute first-attempt-completion and token-cost over the last 10 kernel/* tasks before this pilot.

| Metric | Value |
|---|---|
| First-attempt completion rate | TBD-day-1 |
| Avg tokens / task | TBD-day-1 |
| Sample tasks (10) | TBD-day-1 |

## Entries

(none yet)

## Summary (2026-06-15)

(written on evaluation day)
```

- [ ] **Step 2: Verify**

Run: `rtk cat wiki/Research/Pilots/2026-05-23-team-ownership-dev-contract/log.md | rtk grep -c "type: pilot-log"`
Expected: `1`

### Task 0.3: MissionBrief skill

**Files:**
- Create: `.claude/skills/mission-brief/SKILL.md`

- [ ] **Step 1: Write the skill**

```markdown
---
name: mission-brief
description: Compose a MissionBrief YAML block to prepend to any Agent dispatch during the team-ownership dev-contract pilot (2026-05-23 → 2026-06-15). Use BEFORE spawning kernel-warden or any future warden. Fails if missing end-state, why, authority-bounds, or success-criteria.
---

# MissionBrief

Mandatory input contract for warden dispatch during the team-ownership pilot.

## When to invoke

- Before any `Agent` call targeting a warden agent (`kernel-warden`, future wardens).
- Optional for vanilla cavecrew agents during pilot, but encouraged.

## Schema

Prepend this YAML block (inside a fenced code block, language `yaml`) at the very top of the Agent prompt:

\`\`\`yaml
mission-brief:
  end-state: <one sentence, measurable. e.g., "Loop-detector streak counter resets on ACTION steps only; existing 2458 tests still pass.">
  why: <one sentence, the constraint or motivation. e.g., "Observations resetting the streak masked IC-1 loop bug; project memory entry feedback_clean_types.md.">
  key-tasks: <ordered list, ≤5 items>
  authority-bounds:
    paths: <glob list of paths the warden may Read/Edit>
    commands: <list of bash commands the warden may run>
    out-of-scope: <explicit list — refuse rather than escalate silently>
  success-criteria: <deterministic gates: tests-green | file:line landmark | LOC delta ceiling | ablation-warden lift threshold>
  retries-allowed: <integer, default 2>
\`\`\`

## Validation rule

Refuse to dispatch if any required field (end-state, why, authority-bounds.paths, success-criteria) is missing or contains "TBD" / "TODO" / vague phrasing.

## Example

\`\`\`yaml
mission-brief:
  end-state: "loop-detector.ts:102 streak counter resets only on ACTION steps; 2458 tests green."
  why: "IC-1 (Apr 12) regression — observations were resetting streak, masking infinite loops. Per memory feedback_clean_types.md."
  key-tasks:
    - Read loop-detector.ts to locate streak-reset call sites
    - Write failing test asserting streak persists across observation
    - Implement guard
    - Run typecheck + targeted test
    - Run full reasoning package suite
  authority-bounds:
    paths:
      - packages/reasoning/src/kernel/capabilities/reflect/loop-detector.ts
      - packages/reasoning/src/kernel/capabilities/reflect/*.test.ts
    commands:
      - bunx turbo run typecheck --filter=@reactive-agents/reasoning
      - bun test packages/reasoning/src/kernel/capabilities/reflect/
    out-of-scope:
      - Edits outside packages/reasoning/src/kernel/
      - Changes to act.ts or terminate.ts
  success-criteria: "Targeted test fails before, passes after; full reasoning suite green; no LOC delta > 30."
  retries-allowed: 2
\`\`\`

## Pilot expiry

This skill is part of the team-ownership dev-contract pilot. See [[2026-05-23-team-ownership-dev-contract-pilot]]. If pilot is killed on 2026-06-15, this file is removed in the revert commit.
```

- [ ] **Step 2: Verify**

Run: `rtk cat .claude/skills/mission-brief/SKILL.md | rtk grep -c "^mission-brief:"`
Expected: ≥ 2 (schema example + sample).

### Task 0.4: UpwardReport skill

**Files:**
- Create: `.claude/skills/upward-report/SKILL.md`

- [ ] **Step 1: Write the skill**

```markdown
---
name: upward-report
description: Mandatory output contract for warden agents during the team-ownership dev-contract pilot. Warden agents append a YAML upward-report block as the last content of their response. Parent (main thread) parses and routes via dispatcher FSM. Use when you are a warden agent finishing a task, OR when you are the parent consuming a warden's output.
---

# UpwardReport

Mandatory structured output for warden agents during the team-ownership pilot. Mirrors A2A `TaskState` per [[2026-05-18-agentic-team-ownership-concepts]] §gap-2.

## Format (append as LAST content in warden response)

\`\`\`yaml
upward-report:
  status: completed | failed | blocked | denied-by-authority
  confidence: 0.0-1.0
  blockers:
    - <concrete: file:line | error string | missing dep>
  escalation-required: true | false
  escalation-reason: <if true>
  evidence-anchors:
    - <file:line | command-output | test-id>
  planned-actions-pending-approval:
    - <if high-impact action queued but not yet executed — Marquet "I intend to..." pattern>
  notes: <one line, optional>
\`\`\`

## Field rules

- **status `completed`** + `confidence < 0.7` → parent runs verifier (deterministic gates), does NOT re-prompt warden for self-review.
- **status `failed`** + non-empty `blockers` + `retries-allowed > 0` (from MissionBrief) → parent re-dispatches with blockers injected into next brief.
- **status `failed`** + retries exhausted OR `escalation-required: true` → parent escalates via `AskUserQuestion`. NEVER silent retry past retry budget.
- **status `denied-by-authority`** → parent escalates. Cannot re-plan around an authority bound; widening = user decision.
- **planned-actions-pending-approval** non-empty → parent gates before warden executes; high-impact actions ("delete file X", "rename API Y across N callers") require this.

## Dispatcher FSM (parent thread behavior)

Mirror this table to `AGENTS.md` PILOT section.

| Report state | Parent action |
|---|---|
| `completed`, confidence ≥ 0.7 | Run verifier (typecheck + targeted tests). Pass → accept. |
| `completed`, confidence < 0.7 | Run verifier + ablation-warden if change is a new mechanism. NEVER re-prompt warden for self-review (M3 REWORK precedent). |
| `failed`, blockers present, retries remain | Re-dispatch with blockers in MissionBrief.key-tasks |
| `failed`, retries exhausted OR escalation-required | Escalate via AskUserQuestion. |
| `denied-by-authority` | Escalate. Authority widening is user-only. |
| `blocked` | Surface blocker to user; do not re-dispatch. |

## Anti-pattern (refuse these)

- ❌ Parent runs another LLM call to "review" warden's output → recreates verifier.ts:217-222 double-rejection failure and M3 verify-retry loop.
- ❌ Silent retry past `retries-allowed`.
- ❌ Authority widening without user gate.
- ❌ Accepting `completed` + `confidence < 0.7` without running deterministic verifier.

## Pilot expiry

Part of team-ownership dev-contract pilot. Removed in revert commit on 2026-06-15 if pilot killed.
```

- [ ] **Step 2: Verify**

Run: `rtk grep -c "^upward-report:\|## Dispatcher FSM\|Anti-pattern" .claude/skills/upward-report/SKILL.md`
Expected: ≥ 3.

### Task 0.5: kernel-warden agent

**Files:**
- Create: `.claude/agents/kernel-warden.md`

- [ ] **Step 1: Write the agent definition**

```markdown
---
name: kernel-warden
description: Bounded warden for the composable reasoning kernel (packages/reasoning/src/kernel/**). Refuses cross-package edits. Loads domain primer at spawn (phase map, loop-detector streak rule, terminate-as-single-owner, M3 REWORK history). Mandatory MissionBrief input, mandatory UpwardReport output. Use ONLY during team-ownership pilot window (2026-05-23 → 2026-06-15) for kernel-scoped tasks.
tools: Read, Edit, Grep, Glob, Bash
---

# kernel-warden

Bounded specialist for `packages/reasoning/src/kernel/**`. Decentralized-command discipline: I own kernel changes end-to-end within authority bounds, return structured `UpwardReport`, refuse out-of-scope work.

## Authority manifest (HARD LIMITS — refuse cross-boundary edits)

**Read/Edit allowed (only):**
- `packages/reasoning/src/kernel/**`
- `packages/reasoning/src/kernel/**/*.test.ts`

**Read allowed (context, no edit):**
- `packages/reasoning/src/strategies/**`
- `packages/core/src/**` (type defs only)
- `wiki/Hot.md`, `wiki/Architecture/Design-Specs/**`

**Bash commands allowed:**
- `bunx turbo run typecheck --filter=@reactive-agents/reasoning`
- `bun test packages/reasoning/src/kernel/**`
- `rtk git diff`, `rtk git log`, `rtk git status`
- `rtk grep`, `rtk find`

**Hard refuse:**
- Edits outside `packages/reasoning/src/kernel/**`
- Commits, pushes, tags (release-warden territory)
- `npm publish`, `bun run release:*`
- Changes to `AGENTS.md`, `CLAUDE.md`, or any wiki/* file (scribe territory)

On hard refuse → return `UpwardReport` with `status: denied-by-authority` and `escalation-required: true`.

## Mandatory I/O contract

**Input:** Parent MUST prepend a `mission-brief:` YAML block per [[mission-brief]] skill. If missing required fields, return immediately with:

\`\`\`yaml
upward-report:
  status: failed
  confidence: 0
  blockers:
    - "MissionBrief missing required field: <field>"
  escalation-required: true
  escalation-reason: "Refuse to act on under-specified intent."
\`\`\`

**Output:** Append `upward-report:` block as last content per [[upward-report]] skill. No exceptions.

## Domain primer (load this into your working context at spawn)

### Kernel directory layout

```
packages/reasoning/src/kernel/
  capabilities/
    act/          ← act.ts (FC + tool execution), guard.ts, tool-gating.ts, tool-parsing.ts
    attend/       ← context-utils.ts, tool-formatting.ts
    comprehend/   ← task-intent.ts
    decide/       ← arbitrator.ts (SINGLE TERMINATION OWNER — see FIX-18)
    reason/       ← think.ts, think-guards.ts, stream-parser.ts
    reflect/      ← loop-detector.ts, reactive-observer.ts, strategy-evaluator.ts
    sense/        ← step-utils.ts
    verify/       ← evidence-grounding.ts, quality-utils.ts, requirement-state.ts, verifier.ts
  loop/           ← runner.ts (1739 LOC), react-kernel.ts, terminate.ts (single-owner helper), auto-checkpoint.ts, output-assembly.ts, output-synthesis.ts
  state/          ← kernel-state.ts, kernel-hooks.ts, kernel-constants.ts
  utils/          ← diagnostics.ts, ics-coordinator.ts, lane-controller.ts, service-utils.ts
```

### Load-bearing invariants (do not violate)

1. **Loop-detector streak rule** (`kernel/capabilities/reflect/loop-detector.ts:102`): only ACTION steps reset `maxConsecutiveThoughts`. Observations do NOT reset. IC-1 fix Apr 12. Test enforces.
2. **Single termination owner**: `kernel/loop/terminate.ts` is the only helper that finalizes. `arbitrator.ts` (`kernel/capabilities/decide/arbitrator.ts`) is the only terminal-phase decider. No other file calls into termination directly. Stage 5 W4 / FIX-18.
3. **Two records, distinct purposes**: `state.messages[]` = provider conversation; `state.steps[]` = system observations. Never confuse. Never merge.
4. **No LLM re-verify loop** (verifier.ts:217-222): the project removed parent-side LLM verify-retry. Do not propose anything that recreates it. M3 REWORK precedent (May 12, commit `051c22be`).
5. **Strategy switching default-on** (`runtime.ts:915`): `enableStrategySwitching !== false`. Gated off by `withLeanHarness()`.

### Known failure modes (refuse PRs reintroducing these)

| FM | Symptom | Anchor |
|---|---|---|
| Observation resetting streak | Infinite loop unmasked | `loop-detector.ts:102` IC-1 |
| Multiple termination paths | Race / inconsistent finalization | terminate.ts must remain single-owner |
| `withReasoning()` silent drop | Strategy ignored | IC-2 Apr 12 |
| Verifier double-rejection | False negatives, wasted tokens | `verifier.ts:217-222` removal |
| qwen3 thinking force-on | Token blowup | resolved W7, must stay OPT-IN at `local.ts:226-251` |

## Workflow (every spawn)

1. Read MissionBrief. If invalid → return `denied-by-authority` immediately.
2. Read the load-bearing files named in MissionBrief.key-tasks. Confirm authority paths cover the work. If not → return `denied-by-authority`.
3. Plan internally. If any planned-action is high-impact (rename across N callers, delete file, schema change), set `planned-actions-pending-approval` in a preliminary `upward-report` and STOP for parent approval before executing.
4. Execute TDD where applicable (kernel changes that affect behavior require failing test first per [[agent-tdd]] skill).
5. Run authority-allowed verification commands. Record evidence-anchors (file:line, test id, command output snippets).
6. Compose final `upward-report` with honest confidence. Confidence < 0.7 when: untested edge case remains, suite green but mechanism is new, ablation not run.
7. Return.

## Pilot expiry

Pilot window: 2026-05-23 → 2026-06-15. See [[2026-05-23-team-ownership-dev-contract-pilot]]. On revert, this file is removed.
```

- [ ] **Step 2: Verify schema validity**

Run: `rtk head -10 .claude/agents/kernel-warden.md`
Expected: `name: kernel-warden`, `description:` non-empty, `tools:` list present.

### Task 0.6: AGENTS.md — add PILOT section

**Files:**
- Modify: `AGENTS.md` (insert new section after `## Development Workflow` and before `## Plans, Specs & Knowledge Storage`)

- [ ] **Step 1: Locate insertion anchor**

Run: `rtk grep -n "^## Plans, Specs & Knowledge Storage" AGENTS.md`
Expected: single line number (~249).

- [ ] **Step 2: Insert PILOT section before that anchor**

Insert this block immediately BEFORE the `## Plans, Specs & Knowledge Storage` heading:

```markdown
## Team-Ownership Dev Contract (PILOT — expires 2026-06-15)

> **Status:** ablation pilot per [[wiki/Planning/Implementation-Plans/2026-05-23-team-ownership-dev-contract-pilot.md]]. Default-revert on 2026-06-15 unless lift threshold met. Do not extend without affirmative evidence.

### Forcing function (REQUIRED during pilot window)

Between **2026-05-23** and **2026-06-15**, any edit whose primary scope is `packages/reasoning/src/kernel/**` MUST be routed through `kernel-warden` via Agent dispatch with a valid MissionBrief. Main-thread direct edits during the pilot window violate the contract and disqualify the task from pilot data.

**Single exception:** hot-fix to red CI on `main`, logged with `bypass-reason` in `wiki/Research/Pilots/2026-05-23-team-ownership-dev-contract/log.md`.

### Required schemas

- `MissionBrief` — input contract, see `.claude/skills/mission-brief/SKILL.md`
- `UpwardReport` — output contract, see `.claude/skills/upward-report/SKILL.md`

### Dispatcher FSM (main-thread behavior on warden output)

| Report state | Parent action |
|---|---|
| `completed`, confidence ≥ 0.7 | Run verifier (typecheck + targeted tests). Pass → accept. |
| `completed`, confidence < 0.7 | Run verifier + ablation-warden if change is a new mechanism. **Never** re-prompt warden for self-review (M3 REWORK precedent). |
| `failed`, blockers present, retries remain | Re-dispatch with blockers injected into next MissionBrief.key-tasks |
| `failed`, retries exhausted OR escalation-required | Escalate via AskUserQuestion. |
| `denied-by-authority` | Escalate. Authority widening = user decision. |
| `blocked` | Surface blocker to user; do not re-dispatch. |

### Anti-patterns (refuse these — load-bearing)

- ❌ Parent re-prompts warden to "review your own work" — recreates `verifier.ts:217-222` failure mode and M3 verify-retry loop.
- ❌ Silent retry past `retries-allowed` in MissionBrief.
- ❌ Warden widens its own authority without parent gate.
- ❌ New warden role added before `ablation-warden` shows ≥3pp lift over current setup.

### Logging requirement

Every pilot-window kernel/* task: append one YAML block to `wiki/Research/Pilots/2026-05-23-team-ownership-dev-contract/log.md` per the format documented there.

### Evaluation

**Date:** 2026-06-15. **Owner:** Tyler. **Decision:** canonicalize (Phase 2 — add provider-warden, harness-warden, ablation-warden, debrief-scribe) OR revert (single commit removing all pilot files). **Inconclusive → kill** per default.
```

- [ ] **Step 3: Verify insertion**

Run: `rtk grep -n "## Team-Ownership Dev Contract (PILOT" AGENTS.md`
Expected: one line number, between line 206 (Development Workflow start) and the original `## Plans, Specs` line.

### Task 0.7: Commit Phase 0 scaffold

- [ ] **Step 1: Inspect diff**

Run: `rtk git status; rtk git diff --stat`
Expected: 6 new files + 1 modified (AGENTS.md). No other changes.

- [ ] **Step 2: Stage and commit**

```bash
rtk git add wiki/Planning/Implementation-Plans/2026-05-23-team-ownership-dev-contract-pilot.md
rtk git add wiki/Research/Pilots/2026-05-23-team-ownership-dev-contract/README.md
rtk git add wiki/Research/Pilots/2026-05-23-team-ownership-dev-contract/log.md
rtk git add .claude/skills/mission-brief/SKILL.md
rtk git add .claude/skills/upward-report/SKILL.md
rtk git add .claude/agents/kernel-warden.md
rtk git add AGENTS.md
git commit -m "$(cat <<'EOF'
chore(workflow): scaffold team-ownership dev-contract pilot (expires 2026-06-15)

Ablation-gated pilot per [[2026-05-18-agentic-team-ownership-concepts]] and
North Star §9. Routes all packages/reasoning/src/kernel/** edits through
bounded kernel-warden with MissionBrief input + UpwardReport output during
the 3-week window. Default-revert on 2026-06-15 unless lift threshold met.

Scaffold:
- kernel-warden agent (.claude/agents/kernel-warden.md)
- MissionBrief + UpwardReport schema skills (.claude/skills/)
- AGENTS.md "Team-Ownership Dev Contract (PILOT)" section
- Pilot charter + log stub (wiki/Research/Pilots/)
- This plan (wiki/Planning/Implementation-Plans/)

Cleanup on kill: one revert commit on this hash.
EOF
)"
```

- [ ] **Step 3: Verify commit**

Run: `rtk git log -1 --stat`
Expected: 7 files changed, recent timestamp.

---

## Phase 1: Trial (2026-05-24 → 2026-06-14, runs across sessions)

Phase 1 is **work-driven**, not a single-session deliverable. The following tasks execute as real kernel/* edits arise. Each represents one logical task routed through the warden.

### Task 1.0: Compute baseline on day 1 of trial

**Files:**
- Modify: `wiki/Research/Pilots/2026-05-23-team-ownership-dev-contract/log.md` (Baseline section)

- [ ] **Step 1: Identify last 10 kernel/* tasks pre-pilot**

Run:
```bash
rtk git log --oneline --pretty='%H %s' -- packages/reasoning/src/kernel/ | head -40 | rtk grep -v 'Merge\|merge' | head -10
```
Expected: 10 commits with short messages.

- [ ] **Step 2: Compute first-attempt-completion rate**

For each of those 10 commits, check whether a fixup/followup commit landed within 24h on the same scope:
```bash
# For each sha, list commits within next 24h on same paths
```
Manual classification. Record per-task: `first-attempt: true | false` in a scratch list.

- [ ] **Step 3: Compute baseline avg tokens / task**

Run: `rtk gain --history | rtk grep kernel | head -20`
Expected: token deltas. Compute mean over the same 10 tasks if data available; else mark "baseline-token-estimate: insufficient pre-pilot data" and rely on rate metric only.

- [ ] **Step 4: Write baseline to log**

Edit `wiki/Research/Pilots/2026-05-23-team-ownership-dev-contract/log.md` `## Baseline` section: fill in the metric table with concrete numbers and list the 10 sample task slugs.

- [ ] **Step 5: Commit baseline**

```bash
rtk git add wiki/Research/Pilots/2026-05-23-team-ownership-dev-contract/log.md
git commit -m "chore(pilot): record team-ownership pilot baseline (10 kernel/* tasks)"
```

### Task 1.N (repeat per pilot kernel/* task)

Every kernel/* task during the window follows this template. No need to pre-enumerate — instances created as work arises.

- [ ] **Step 1: Compose MissionBrief**

Invoke `mission-brief` skill. Validate all required fields.

- [ ] **Step 2: Dispatch kernel-warden**

```
Agent({
  description: "<task slug>",
  subagent_type: "kernel-warden",
  prompt: "<MissionBrief YAML block>\n\n<task description>"
})
```

- [ ] **Step 3: Parse UpwardReport from warden output**

Locate the trailing `upward-report:` YAML block. Validate schema (status, confidence, evidence-anchors present).

- [ ] **Step 4: Route via Dispatcher FSM**

Match report state to AGENTS.md FSM table. Execute parent action. NEVER LLM-re-verify.

- [ ] **Step 5: Run deterministic verifier**

Run authority-allowed verification commands per MissionBrief.success-criteria. Confirm pass.

- [ ] **Step 6: Log to pilot log**

Append YAML block to `wiki/Research/Pilots/2026-05-23-team-ownership-dev-contract/log.md` § Entries:

```yaml
- task: <slug>
  date: YYYY-MM-DD
  routed: warden
  commits: <count>
  agent-spawns: <count>
  tokens-est: <from rtk gain>
  regression-prevented: <description | none>
  notes: <one line>
```

- [ ] **Step 7: Commit log entry**

```bash
rtk git add wiki/Research/Pilots/2026-05-23-team-ownership-dev-contract/log.md
git commit -m "chore(pilot): log <task-slug> outcome"
```

### Task 1.E (exception path — main-thread bypass)

When circumstances force a bypass (red CI hot-fix only):

- [ ] **Step 1: Make the edit on main thread**

(Hot-fix only.)

- [ ] **Step 2: Log bypass**

Append:
```yaml
- task: <slug>
  date: YYYY-MM-DD
  routed: bypass
  bypass-reason: "red CI hot-fix"
  commits: 1
  agent-spawns: 0
  tokens-est: <est>
  notes: <one line>
```

- [ ] **Step 3: Commit log entry alongside hot-fix**

---

## Phase 2: Evaluation (2026-06-15, single session)

### Task 2.1: Compile evidence

- [ ] **Step 1: Count pilot entries**

Run: `rtk grep -c '^- task:' wiki/Research/Pilots/2026-05-23-team-ownership-dev-contract/log.md`
Expected: integer N.

- [ ] **Step 2: Compute pilot metrics**

For all `routed: warden` entries:
- First-attempt rate = count(commits=1) / count(entries)
- Avg tokens = mean(tokens-est)
- Avg re-spawns = mean(agent-spawns)
- Regression-catches = count(regression-prevented ≠ "none")

Record in log.md `## Summary` section.

- [ ] **Step 3: Compare against thresholds**

Apply lift / kill criteria from this plan §Pre-stated. Decide:
- **Canonicalize** (lift threshold met)
- **Revert** (kill threshold met OR N < 10 OR inconclusive)

### Task 2.2-A: Canonicalize (lift confirmed)

- [ ] **Step 1: Promote PILOT section in AGENTS.md**

Remove `(PILOT — expires 2026-06-15)` from heading. Rename to `## Team-Ownership Dev Contract`. Remove expiry banner. Remove "Single exception" reference to pilot.

- [ ] **Step 2: Write Phase 2 expansion plan**

Create `wiki/Planning/Implementation-Plans/2026-06-15-team-ownership-dev-contract-phase-2.md`: introduce provider-warden, harness-warden, ablation-warden, debrief-scribe — each separately ablation-gated per the same discipline.

- [ ] **Step 3: Commit canonicalization**

```bash
rtk git add AGENTS.md wiki/Planning/Implementation-Plans/2026-06-15-team-ownership-dev-contract-phase-2.md
git commit -m "feat(workflow): canonicalize team-ownership dev contract (lift confirmed)"
```

- [ ] **Step 4: Write debrief**

Create `wiki/Research/Debriefs/2026-06-15-team-ownership-pilot-debrief.md` with: lift evidence (numbers), surprises, Phase 2 gates.

### Task 2.2-B: Revert (kill threshold met or inconclusive)

- [ ] **Step 1: Revert scaffold commit**

```bash
rtk git revert <sha-of-task-0.7-commit> --no-edit
```

- [ ] **Step 2: Write debrief on why it didn't work**

Create `wiki/Research/Debriefs/2026-06-15-team-ownership-pilot-debrief.md` with: kill evidence, what we learned (e.g., "specialization didn't justify token overhead", "MissionBrief friction outweighed benefit"), what NOT to retry, what might be worth retrying differently later. Crucially: name the lesson so it lands in memory rather than the playbook being reattempted blindly.

- [ ] **Step 3: Commit debrief**

```bash
rtk git add wiki/Research/Debriefs/2026-06-15-team-ownership-pilot-debrief.md
git commit -m "chore(pilot): debrief team-ownership pilot (reverted — REWORK verdict)"
```

- [ ] **Step 4: Update memory**

Add entry to `.agents/MEMORY.md` and Claude memory: "Team-ownership dev-contract pilot reverted 2026-06-15. Reason: <one line>. Do not retry without addressing root cause: <one line>."

---

## Out of scope (explicit, do not expand pilot)

- Multiple wardens (provider-warden, harness-warden, etc.) — Phase 2 only.
- Runtime multi-agent contract changes — separate concern, see [[2026-05-18-agentic-team-ownership-concepts]].
- New warden builder method or new contract types — doc §Conflict-Warning-3 forbids.
- LLM re-verify of warden output — doc §Conflict-Warning-1 forbids. Use deterministic verifier only.
- Default-on without lift evidence — North Star §9 + M3 REWORK precedent forbid.

## Self-review (run before execution)

- [x] **Spec coverage:** every concept from the user's question + [[2026-05-18-agentic-team-ownership-concepts]] gap table maps to a Phase 0 file or a Phase 1/2 task.
- [x] **No placeholders:** baseline computation has explicit `rtk` commands; only intentional TBDs are values-yet-to-compute-on-day-1, clearly marked.
- [x] **Type consistency:** MissionBrief field names match across skill schema, kernel-warden refusal block, and AGENTS.md FSM. UpwardReport states (`completed | failed | blocked | denied-by-authority`) consistent across all 4 files.
- [x] **Forcing function present:** AGENTS.md PILOT section + charter both state mandatory routing rule.
- [x] **Hard expiry present:** 2026-06-15 in plan frontmatter, charter, AGENTS.md heading, every reference.
- [x] **Measurable kill criteria:** 4 numeric thresholds + 1 binary (user friction) + 1 quorum (N≥10), all measurable via existing tooling.
- [x] **Cleanup path:** single revert commit. Total scaffold ≤ 7 files.

## Execution handoff

Plan complete and saved to `wiki/Planning/Implementation-Plans/2026-05-23-team-ownership-dev-contract-pilot.md`. Phase 0 is executable in this session (≤ 30 minutes). Phase 1 runs across sessions over the 3-week window. Phase 2 is a single evaluation session on 2026-06-15.
