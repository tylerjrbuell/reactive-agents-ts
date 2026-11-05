---
name: upward-report
description: Mandatory closing block for every warden response, and the input the parent routes on. Use when you are a warden finishing (or stopping) a mission, or when you are the parent reading a warden's result. The wardens SubagentStop hook checks it, and `bun run repo warden-report` validates it and names the next action.
---

# UpwardReport — truth out

> **Vendored** from [tylerjrbuell/wardens](https://github.com/tylerjrbuell/wardens) `skills/upward-report/SKILL.md` (contract v2) so non-Claude agents see the same contract. `bun run repo warden-report` (`tools/repo/src/commands/warden-report.ts`) implements the same rules. Edit upstream first, then re-sync both. History: [[2026-09-03-warden-pilot-ratified]].

The warden owns the outcome, including a bad one. The report says what happened in a form the parent can route on without having to interpret it. Make it the **last content** of the response.

## In this repo

- Before reporting `completed`, run `bun run repo verify <pkg-dir>` and put the result under `verification`.
- Self-check before you send: `bun run repo warden-report -`. The parent runs the same command and follows its `next:` line.

## Format

```yaml
upward-report:
  status: completed | failed | blocked | denied-by-authority | needs-approval
  confidence: 0.0-1.0
  files-changed:
    - <path>
  verification:                     # commands YOU ran this session, with their result
    - "<command> → <result>"
  evidence-anchors:                 # where the parent can check your claims
    - <file:line | test id | command output excerpt>
  blockers:                         # concrete: file:line, error string, missing dependency, out-of-scope path
    - <blocker>
  planned-actions:                  # needs-approval only: "I intend to …" (legacy name planned-actions-pending-approval still accepted)
    - <action>
  escalation-required: false
  escalation-reason: <required when escalation-required is true>
  notes: <one line, optional>
```

## Status: pick exactly one

| Status | Meaning | Required | `warden-report` next |
|---|---|---|---|
| `completed` | End-state met, inside authority | `verification` if confidence ≥ 0.7 | `verify` (≥ 0.7) / `verify-with-ablation` (< 0.7) |
| `failed` | Tried, end-state not met, and you know why | `blockers` | `redispatch` (retries left) / `escalate` |
| `blocked` | Something outside any warden's reach: credentials, broken infra, a decision only a human can make | `blockers` | `surface-blocker` |
| `denied-by-authority` | The work needs a path or command outside your authority (or the guard denied one) | `blockers` naming the path/command | `reroute` to the owner (`escalate` if escalation-required) |
| `needs-approval` | You have a plan, and part of it is high-impact (delete, cross-caller rename, schema/API change). You stopped before doing it | `planned-actions` | `gate` |

## Confidence is tied to evidence

| Confidence | Means |
|---|---|
| ≥ 0.9 | Every success criterion verified by a command you ran; no known open edge |
| 0.7 – 0.9 | Verified, but there's a known untested edge or the mechanism is new |
| 0.4 – 0.7 | Partially verified |
| < 0.4 | Not verified |

Confidence ≥ 0.7 with an empty `verification` is invalid. If you don't have the evidence, don't claim the confidence.

## Rules for the warden

- **Own it.** No "the model was flaky" or "pre-existing issue" without an anchor that proves it, such as a stash-and-rerun baseline.
- **Don't work around the guard.** A denied tool call means your report is `denied-by-authority`. Don't try another route to the same edit.
- **Don't commit, push, tag, or publish.** Integration belongs to the parent.
- **Report surprises in `notes`.** They feed the debrief.

## For the parent

Follow the `next:` line from `bun run repo warden-report`. Never answer a report by asking the same warden to "double-check its work": that recreates the `verifier.ts:217-222` double-rejection failure and the M3 verify-retry loop. Re-run the deterministic gates yourself.
