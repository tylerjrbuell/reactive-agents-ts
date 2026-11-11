---
type: decision
status: proposed
created: 2026-11-11
tags: [dev-workflow, wardens, ownership, governance]
related:
  - "[[2026-11-05-wardens-one-file-hook-enforced]]"
  - "[[2026-09-03-warden-pilot-ratified]]"
---

# Warden ownership gaps (proposed)

## Problem

`tools/repo/ownership.json` has 24 globs with `owner: null`. Work on them either
stalls or lands as main-thread edits outside the warden contract. On 2026-11-11 two
fixes stalled for this reason: replay ordering/alignment (`packages/replay`) and the
guardrails PII regex (`packages/guardrails`). The upcoming Cortex Evals tab (C12) and
structured-output graders will need `packages/eval`, and the live human gate touches
`packages/interaction`.

The AGENTS.md rule stands: prefer widening an existing warden; a new warden needs owner
approval plus evidence of unowned edits.

## Evidence (commits touching the path, 2026-10-11 to 2026-11-11; src LOC)

| Path | Commits | src LOC | Pressure |
|---|---|---|---|
| packages/benchmarks | 36 | 15.6k | high (measurement) |
| packages/observability | 11 | 5.9k | medium |
| packages/testing | 8 | 3.2k | medium |
| packages/replay | 7 | 1.1k | blocked fix today |
| packages/eval | 4 | 1.9k | C12 next |
| packages/create-reactive-agent | 4 | 1.2k | low |
| packages/guardrails | 3 | 1.1k | blocked fix today |
| packages/judgment | 3 | 1.5k | Jev plan open |
| packages/identity, interaction, judge-server, verification | 2 each | 0.6–1.6k | low / live gate |
| packages/a2a, channels, cost, gateway, health, observe | 1 each | 0.2–1.7k | low |
| apps/cli | 10 | — | medium |
| apps/advocate, examples, stackblitz | 2–4 | — | low |
| apps/docs | 164 | — | shared by every warden |
| tools/repo | 55 | — | main thread (dev CLI) |

## Proposal

### Widen existing wardens (no new roles)

| Warden | Add | Why it fits |
|---|---|---|
| harness-warden | `packages/replay`, `packages/benchmarks` | Same instrument family as trace/diagnose (`diffTraces`, replay layers, bench cells). Extends its existing "owns its instrument" exception. |
| core-warden | `packages/observability`, `packages/observe`, `packages/testing` | Event and trace infrastructure plus shared test doubles (test provider, mocks) that every package builds on. |
| tools-warden | `packages/guardrails`, `packages/identity` | Security surface next to the shell sandbox; the PII regex fix goes here first. |
| runtime-warden | `packages/interaction`, `packages/cost`, `packages/health` | Facade-wired services; the live human gate already reaches into interaction. |

### One new warden (needs owner approval)

**eval-warden**: `packages/eval`, `packages/judgment`, `packages/judge-server`,
`packages/verification` (about 5.2k src LOC). This is the quality-measurement domain. It
has three committed workstreams: the Cortex Evals tab (C12), deterministic structured-output
graders, and the TypeSafe/Jev judgment plan. `kernel-warden` already owns reasoning and
reactive-intelligence, so adding these would overload it.

### Park, with a trigger

| Paths | Trigger to act |
|---|---|
| `packages/gateway`, `packages/channels`, `packages/a2a` | 3 main-thread edits in 30 days → create `gateway-warden` (networked and persistent agents) |
| `apps/cli`, `packages/create-reactive-agent`, `apps/examples`, `apps/stackblitz`, `apps/advocate` | 3 main-thread edits in 30 days → create `dx-warden` (onboarding surfaces) |
| `apps/docs` | Stays shared: each warden updates the docs for its own change (existing rule). |
| `tools/repo` | Stays with the main thread; it is the dev tool the wardens run on. |

## Apply steps (after approval)

1. Edit `tools/repo/ownership.json` (owner per glob) and, for eval-warden, add its
   entry in `.claude/wardens.yaml` plus a primer in `.claude/agents/eval-warden.md`.
2. Run `warden doctor --strict` (CI `check-wardens`) to catch overlaps and typos.
3. Dispatch the parked fixes: replay ordering → harness-warden; guardrails PII regex →
   tools-warden.

## Open questions for the owner

- Approve eval-warden, or fold eval/judgment into harness-warden instead?
- Is benchmarks under harness-warden right, or should ablation-warden own it?
