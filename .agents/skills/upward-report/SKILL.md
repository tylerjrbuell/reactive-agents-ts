---
name: upward-report
description: Mandatory output contract for warden agents during the team-ownership dev-contract pilot. Warden agents append a YAML upward-report block as the last content of their response. Parent (main thread) parses and routes via dispatcher FSM. Use when you are a warden agent finishing a task, OR when you are the parent consuming a warden's output.
---

# UpwardReport

Mandatory structured output for warden agents during the team-ownership pilot. Mirrors A2A `TaskState` per [[2026-05-18-agentic-team-ownership-concepts]] §gap-2.

## Format (append as LAST content in warden response)

```yaml
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
```

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
