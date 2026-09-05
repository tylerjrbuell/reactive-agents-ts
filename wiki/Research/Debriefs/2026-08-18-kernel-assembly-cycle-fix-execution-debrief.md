# Execution Retro: kernel-assembly-cycle-fix
Date: 2026-08-18
Budget: 45 min | Actual: ~30 min

## Outcomes
- Issues closed: #184 (partial fix + drift note)
- Issues filed: #200 (accurate successor with current 8-cycle evidence)
- Net test delta: 0 (2718/0/4todo, unchanged)
- Net LOC delta: +145/-76 across 10 files (new leaf module + 6 stage import redirects + project.ts trim)

## What worked
- Drift check caught a real structural change (assembly/context relocated
  out of kernel/) that a naive "just fix the 9 cited cycles" approach would
  have stumbled on immediately (paths don't exist). Re-running madge fresh
  rather than trusting the issue's pasted output was the right call.
- Scoping to the ONE cluster that still matched the issue's own diagnosis
  and fix direction (assembly, 5 cycles, clean single type-extraction) kept
  the bundle small and low-risk instead of attempting all 14 current cycles
  blind. The other 8 don't share one root cause — bundling them would have
  violated the "coherent bundle" gate.
- Filing a follow-up issue with corrected, current evidence (#200) instead of
  just leaving #184 half-true keeps the backlog honest for the next pass.

## What didn't
- Branch discipline slip: started editing before creating the bundle branch
  (Phase 3.5 requires branch-first). Caught it before committing — retroactively
  branched off the same HEAD with `git checkout -b` (working tree changes carry
  over across a branch-from-same-commit checkout) and staged only the intended
  files, leaving an unrelated pre-existing `github-stats.json` timestamp diff
  out of the commit. No harm done, but worth flagging for the skill.

## Skill improvements (apply on next pass)
- Add a check to Phase 3.5: after the local-main-ahead check and before ANY
  Edit/Write tool call for the bundle, explicitly `git checkout -B bundle/<name>`
  — don't let investigation-phase file reads slide into investigation-phase
  file edits on `main` without noticing. (Self-correcting this in SKILL.md now.)

## Process inflation guard (HS-18/22/31 lesson)
- The opposite of inflation here: #184's cited count (9) undercounted current
  reality (14) — not because the issue lied, but because 5 months passed and
  the codebase moved. Worth normalizing: "verified-by" evidence on any issue
  older than ~4-6 weeks in an actively-refactored package should be treated
  as directionally-true-but-re-verify-before-acting, not as ground truth.
