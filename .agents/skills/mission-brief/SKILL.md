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

```yaml
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
```

## Validation rule

Refuse to dispatch if any required field (end-state, why, authority-bounds.paths, success-criteria) is missing or contains "TBD" / "TODO" / vague phrasing.

## Example

```yaml
mission-brief:
  end-state: "loop-detector.ts:102 streak counter resets only on ACTION steps; 2458 tests green."
  why: "IC-1 (Apr 12) regression — observations were resetting streak, masking infinite loops."
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
```

## Pilot expiry

This skill is part of the team-ownership dev-contract pilot. See [[2026-05-23-team-ownership-dev-contract-pilot]]. If pilot is killed on 2026-06-15, this file is removed in the revert commit.
