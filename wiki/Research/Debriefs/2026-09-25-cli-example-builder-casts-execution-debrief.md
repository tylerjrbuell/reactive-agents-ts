---
type: debrief
status: completed
created: 2026-09-25
authored-by: opencode
related: [[Planning/Implementation-Plans/2026-09-25-cli-example-builder-casts]]
tags: [backlog-execution, cli, type-safety, priority-p1]
---

# Execution Retro: cli-example-builder-casts
Date: 2026-09-25
Budget: 90 min | Actual: ~40 min

## Outcomes

- Issues closed: #225 (plus bundle tracker #229 after local integration).
- Issues descoped: none.
- Net test delta: final workspace rerun was -1 pass / +1 fail vs baseline
  (9,592 pass / 21 fail / 25 skip / 4 todo). The added failure was a workspace-
  order issue in untouched `packages/observability`; its test file passes alone
  (4/0) and the package suite passes (234/0).
- Net LOC delta: +161 / -14 in the fix commit (includes the plan and docs).
- Source-site delta: 9 actual builder-start casts → 5 intentional capability probes.

## What worked

- Removing the CLI cast exposed the actual defect: a broad `string` provider and
  invalid `"google"` literal. Typing `ProviderInfo` from `ProviderName` and using
  `"gemini"` fixed the runtime selection without weakening the builder.
- Grounding the A2A probe against `builder.ts` showed `.withA2A()` already
  exists; deleting that stale existence check left the actual cassette-surface
  checks in place. The offline example smoke still reports the expected gap.
- Workspace build (38/38), typecheck (68/68), targeted CLI checks, direct
  example compile, and docs build all passed. Commit: `5ec4dd63`.

## What didn't

- The issue body undercounted its exact pattern by one and omitted the HITL
  build-chain location. A broader exact-file scan found 9, not 8.
- The first broad examples TypeScript check was blocked by `rootDir` diagnostics;
  overriding rootDir surfaced unrelated diagnostics in untouched examples. A
  direct single-file compiler check gave a clean, scope-appropriate result.
- The first post-change full suite matched baseline (9,593/20). The post-merge
  rerun picked up one additional unrelated observability logger failure under
  workspace test order; file and package isolation both pass. The two
  cast-ceiling failures and 18 Docker-dependent timeouts remain baseline reds.

## Skill improvements (applied in this commit)

- Add an exact-location parity check: when an issue enumerates a count and
  file:line list, enumerate every match across the cited files and compare both
  count and locations; do not infer a clean drift check from the count alone.
- Add a cast-removal follow-through: when deleting a cast exposes a type error,
  trace the diagnostic to the producer/value shape and fix that source (including
  invalid literals) rather than restoring the cast or mislabeling it as builder
  inference friction.

## Process inflation guard (HS-18/22/31 lesson)

- #225 was undercounted by one site (9 in source vs 8 reported); the missing site
  was explicitly called out and the final remaining count is 5.
- #223's supporting command reports 18 files, not 60; the 60 value counts textual
  matches. The 8 silent-catch sites themselves remain present. A correction was
  posted on #223 and the running-issues log now distinguishes files from matches.
