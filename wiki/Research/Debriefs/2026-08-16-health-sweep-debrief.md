# Health Sweep Debrief — 2026-08-16 (v0.15.0 release-prep)

Baseline: build 37/37 GREEN, tests 8903 pass / 0 fail / 1157 files.
Final: build 37/37 GREEN, tests 8905 pass / 0 fail / 1157 files (+2, 0 regressions).

Full findings register: [[Issues/Running Issues Log#Health Sweep — 2026-08-16 (v0.15.0 release-prep)]].

## Trigger

User asked, mid-session, for a pre-release DX/cleanliness pass: "look for any
existing uncataloged high priority issues that could cause a bad DX... make
sure everything is polished... cleanup the code and look for any remaining
low hanging smells or Type gaps or Effect misusage." Ran the
`codebase-health-sweep` skill's standard 4-parallel-agent SCAN → TRIAGE → FIX
loop, scoped to catch drift since the 2026-08-06/07 sweeps plus close scrutiny
on everything shipped earlier this same session (dynamic provider config,
sub-agent inheritance, approval-policy enforcement, repetitionGuard fix,
deterministic evidence grounding, scratchpad disk-spill, tool registration
validation, tool-result safe-stringify, code-action Worker interruption).

## What was fixed

- **HS-224 (P1, correctness):** scratchpad-spill's marker-resolution wiring
  was incomplete — 3 of 5 real read sites bypassed it, so
  `unconsumedEvidenceGuard` would inject the literal `[SPILLED_TO_DISK:...]`
  string into the model-facing grounding prompt instead of real evidence once
  the spill threshold triggered. This is a bug in a feature shipped earlier
  in this same session (the tools-result-handling bundle) — the sweep caught
  it before it shipped in a release.
- **HS-225/HS-226 (P1, robustness):** two "crash instead of degrade" paths —
  unguarded sync disk I/O in `setScratchpadBounded` (Effect defect on
  ENOSPC/EACCES) and an unhandled-promise-rejection race in the code-action
  sandbox's Worker message listener. Both now fail soft.
- **HS-227/HS-228 (P2, DX/cleanliness):** `ToolDefinitionError` now gets a
  proper remediation suggestion instead of the generic fallback; docs gap
  closed; one dead export deleted.

## The one that wasn't real

A parallel scan agent reported a P0: "registration-time tool validation
doesn't fire on the real public path." Investigated with an independent,
from-scratch repro rather than trusting the sub-agent's script — `.build()`
correctly succeeds (registration is lazy, happens on first `run()`, not at
build time) and `.run()` correctly throws the exact `ToolDefinitionError`
naming the tool and field. The sub-agent's own repro likely had a bug (didn't
actually call `run()`, or swallowed the throw) rather than the framework
having a real defect. Logged as a finding-shape in the Issues Log so future
sweeps don't waste a cycle rediscovering the same false trail — and as a
reminder to independently verify a sub-agent's most severe claim before
treating it as the top-priority fix, especially one this size (would have
sent the whole triage toward "the runtime silently swallows layer-
construction defects," which isn't true).

## What was filed, not fixed (P2, out of scope this pass)

- HS-229: duplicate Levenshtein tool-name healer (blueprint vs tools package)
- HS-230: unmemoized O(N) scratchpad-key scan across 5+ call sites per pass
- HS-231: sync disk read in `resolveScratchpadValue`, hot-path-adjacent
- HS-232: `unwrapErrorWithSuggestion` has zero callers — a design question
  (wire into `run()`'s catch, or keep opt-in) more than a bug
- HS-211/HS-213 confirmed resolved since 08-06/07 — need closing in the log,
  not new work

## Top 3 P2 opportunities for next sprint

1. **HS-232** — deciding whether remediation suggestions should be automatic
   on every `agent.run()` failure (currently opt-in via an unused export) is
   a real DX call, cheap to make once decided.
2. **HS-229** — the duplicate tool-name healer is a clean, low-risk dedup
   with an existing precedent (`packages/tools`'s healer) to route through.
3. **HS-230** — the unmemoized scratchpad scan matters more as runs get
   longer; worth profiling before optimizing, but flagged now while fresh.
