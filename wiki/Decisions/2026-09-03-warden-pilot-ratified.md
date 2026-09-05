---
type: decision
status: ratified
created: 2026-09-03
tags: [dev-workflow, multi-agent, extreme-ownership, wardens, governance]
related:
  - "[[2026-05-23-team-ownership-dev-contract-pilot]]"
  - "[[2026-05-18-agentic-team-ownership-concepts]]"
---

# Warden Pilot — Ratified as Permanent (Governance Closeout)

**Decision:** The team-ownership warden program (9 warden agents in `.claude/agents/`
plus the `mission-brief`/`upward-report` schema skills) is ratified as a permanent part
of the dev workflow. Pilot-window language, hard expiry, and revert-on-kill wording are
removed from all 11 files.

## Why this decision exists

`2026-05-23-team-ownership-dev-contract-pilot.md` set a hard expiry of **2026-06-15**
and required an empirical evaluation against pre-stated kill/lift criteria (≥3pp lift,
≤15% token overhead, evaluated via `rtk gain --history`) before canonicalizing OR
reverting. That plan's own frontmatter was marked "superseded" by a 2026-07-31
wiki-lint pass, noting the window had expired six weeks earlier with nothing done. It
sat untouched for a further five weeks after that. Meanwhile the roster grew from the
plan's stated "minimum-viable surface — **one** warden (`kernel-warden`)" to the current
9, without the Phase 2 expansion gate the plan itself required.

**Honesty about what this ratification is and isn't:** this is not a claim that the
ablation evaluation ran and passed. `rtk` was removed from the toolchain in July 2026
(see [[feedback_rtk_usage]] in project memory — it silently truncated output) before
the measurement this plan specified was ever taken. The empirical bar the original plan
set was never met. This decision instead rests on the practical signal available now:
the wardens have been in continued active use for 3+ months past their own expiry, with
no incident driving a revert. That is a real signal, but a weaker one than the
ablation-gated evidence the project's own research discipline
([[01-RESEARCH-DISCIPLINE]]) normally requires. Flagging that gap here rather than
letting it go unstated is the point of this decision doc.

## What changes

- All 9 warden files (`.claude/agents/*-warden.md`, `debrief-scribe.md`) and 2 skill
  files (`mission-brief`, `upward-report`) drop the `## Pilot expiry` section, the
  `Pilot 2026-05-23 → 2026-06-15` line from their `description:` frontmatter, and any
  "removed in revert commit" / "if pilot killed" conditional language.
- A `## Status` section replaces it, pointing here.
- `scripts/check-no-expired-pilots.sh` added (auto-globbed `check-*.sh` CI lane): fails
  if any file under `.claude/agents/` or `.agents/skills/` declares a `Pilot <date> →
  <date>` window whose end date is in the past. This is the mechanical fix for the
  actual failure mode — a status fact sitting in prose that nobody re-reads. Any future
  pilot gets the same hard stop this one should have had.

## What does NOT change

- Warden scope, authority bounds, MissionBrief/UpwardReport contract — unchanged.
- This is not a claim the wardens are net-positive, only that the project is choosing
  to keep using them without having run the originally-specified evaluation. If someone
  later wants to actually measure lift/overhead, `2026-05-23-team-ownership-dev-contract-pilot.md`'s
  kill/lift criteria are still the right ones to reuse (with `rtk` replaced by native
  git/grep/find token accounting, per current tooling).
