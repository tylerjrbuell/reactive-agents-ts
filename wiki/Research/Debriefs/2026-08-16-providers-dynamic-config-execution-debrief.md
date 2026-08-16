# Execution Retro: providers-dynamic-config
Date: 2026-08-16
Budget: 90 min | Actual: ~55 min

## Outcomes
- Issues closed: #198 (via PR #199, open — merge is human decision)
- Issues descoped: none
- Net test delta: +2 pass (litellm-dynamic-config.test.ts, 2 cases), 0 new failures
- Net LOC delta: +257/-5 (9 files: 2 config-typing files, 1 provider adapter, 3 runtime
  plumbing files, 1 new test, 1 plan doc)

## What worked
- SCAN correctly rejected the issue's own proposal shape (`ProviderConfig` /
  `agent.withProvider(ProviderConfig)` as a brand-new interface) after tracing the actual
  code: `litellm` already speaks OpenAI-compat, the real gap was untyped config +
  no builder plumbing, not a missing provider. Single funnel found
  (`createLLMProviderLayer`'s `modelParams`) let the whole feature land as one small,
  additive overload — `commit 18ff67f6`.
- RED→GREEN was authoritative here (not the v10 "RED authority" caveat case): stashed only
  the 3 src files, reran the new test, got real assertion failures against literal
  pre-fix behavior (wrong URL, missing header) — no TaggedError/tsconfig-exclude leniency
  in play.

## What didn't
- **Live cross-session git collision.** A second concurrent Claude Code session
  (`reactive-agents-ts-e7`) was actively committing to the same checkout while this
  bundle executed. Branching off local `HEAD` (per explicit user override of the
  skill's "stop on dirty tree" gate) meant the shared git index picked up my staged
  files into THEIR commit when they ran `git commit` — a single commit ended up
  containing both unrelated features under a misleading message. Recovery
  (`git reset --soft HEAD~1`, restage only my files) itself raced a second time — the
  peer session recommitted mid-recovery, landing a *different* commit hash while my
  reset was in flight. Resolved by checking `ListAgents` mid-incident, confirming the
  peer had gone idle, then redoing the split cleanly.
- Cost ~15 min of pure incident handling, not part of the original estimate.

## Skill improvements (apply on next pass)
1. **Phase 3.5 BRANCH gate needs a live-peer check, not just a one-time dirty-tree
   check.** A clean `git status` at branch time does not mean the checkout stays
   exclusive — another agent session can commit mid-EXECUTE. Before EXECUTE's first
   `git add`, and again immediately before COMMIT, call `ListAgents` (or equivalent)
   and treat any *other active, non-idle* session on the same repo as a hard-stop
   condition until it goes idle. This is now recorded in this doc; SKILL.md Phase 4
   amended below.
2. **`git add <files>` is not isolation on a shared checkout.** Staging specific files
   only protects against accidentally committing *unrelated dirt already on disk* — it
   does NOT protect against a concurrent session's `git commit` sweeping up files you
   staged a moment earlier, because the index is shared process-wide, not per-agent.
   The only real isolation is a dedicated worktree (`superpowers:using-git-worktrees`)
   or confirming no other live session is targeting the same checkout before staging.

## Process inflation guard
- No inflation risk here — this bundle supplied its own verified-by (issue had none on
  arrival) from a fresh grep/read of the actual code, not from a prior claim.
