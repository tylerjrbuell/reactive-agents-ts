---
type: directory-readme
tags: [research, harness, reports, programmatic]
---

# Harness Reports Directory

> **Purpose:** Single source of truth for harness improvement loop reports, baseline measurements, regression artifacts, and phase validation evidence.

## Origin

Moved from `/harness-reports/` to `wiki/Research/Harness-Reports/` in May 2026 consolidation. This directory is now part of the wiki knowledge graph — phase reports, baselines, and diagnostic artifacts are discoverable alongside related debriefs, experiments, and decisions.

## Contents

### Programmatic outputs (managed by `@reactive-agents/testing`)

These are generated automatically by the gate runner (`packages/testing/src/gate/runner.ts`):

| File / Directory | Producer | Purpose |
|------------------|----------|---------|
| `integration-control-flow-baseline.json` | `gate-propose.ts` | Frozen-state Tier1Baseline, validated against on every CI run |
| `integration-control-flow-scenario-health.json` | gate runner | Per-scenario stability metrics |
| `regressions/<id>-<iso>.jsonl` | gate runner (on failure) | Trace archive for any regression |
| `gate-traces/` | gate runner | Full trace data for the gate suite |
| `loop-state.json` | improvement-loop scripts | Cross-session state for the harness improvement loop |

### Human-authored research artifacts

| Pattern | Purpose |
|---------|---------|
| `phase-N-<focus>-YYYY-MM-DD.md` | Per-phase evidence artifacts (raw data, methodology, gate result) |
| `improvement-report-YYYYMMDD-<focus>.md` | Per-session improvement log |
| `<probe-name>-baseline.json` | Probe-specific baselines (e.g., phase-0-frozen-judge-baseline.json) |
| `<topic>-FINDINGS-FOR-<phase>.md` | Findings handoff between phases |
| `_archive/` | Older runs (preserved for historical reference) |

## Convention for new reports

When adding new reports, follow these patterns:

### Phase reports
```
wiki/Research/Harness-Reports/phase-N-<focus>-YYYY-MM-DD.md
```

Example: `phase-1-mechanism-validation-2026-05-04.md`

### Improvement logs
```
wiki/Research/Harness-Reports/improvement-YYYY-MM-DD.md
```

One paragraph per fix — don't reach for the heavy template.

### Baseline measurements
```
wiki/Research/Harness-Reports/<scenario>-baseline.json
wiki/Research/Harness-Reports/<scenario>-postimpl.json
```

Always commit baselines with the corresponding measurement code change.

## Cross-link to the knowledge graph

Reports here should link to (and be linked from):

- **Mechanism validations:** `wiki/Experiments/M*.md` — link to the trace evidence in this directory
- **Failure modes:** `wiki/Failure-Modes/FM-*.md` — link to baseline measurements that surfaced the FM
- **Debriefs:** `wiki/Research/Debriefs/` — link from a debrief to the harness-report evidence that motivated it
- **Decisions:** `wiki/Decisions/` — link to baselines that justified the decision

Use Obsidian wikilinks: `[[Research/Harness-Reports/phase-1-mechanism-validation-2026-05-04|Phase 1 evidence]]`.

## For the harness improvement loop

This is the canonical output directory. See `.agents/skills/harness-improvement-loop/SKILL.md` for the full workflow:

1. **Phase 2 (Probe):** Probe scripts write JSON summaries here
2. **Phase 6 (Verify):** Before/after diffs reference baselines stored here
3. **Phase 7 (Commit):** Reports here serve as empirical evidence in commit messages

### Probe scripts

Located at `.agents/skills/harness-improvement-loop/scripts/`:

- `task-quality-gate.ts` — 5-task probe (T1-T5)
- `harness-probe.ts` — wider 5-probe baseline
- `harness-probe-wide.ts` — full cross-strategy suite
- `harness-evolve.ts` — auto-generates next-iteration improvements

All write to `wiki/Research/Harness-Reports/` (the value of `REPORTS_DIR` in `packages/testing/src/gate/runner.ts`).

## Programmatic vs human-readable

This directory mixes both:
- **Programmatic** — JSON files (do not edit by hand; regenerate via probe scripts)
- **Human-readable** — `.md` files (write by hand, follow naming convention above)

Both belong in the wiki because both serve the same purpose: empirical evidence for harness changes.

## Related

- [[../Debriefs|Engineering Debriefs]] — post-feature notes that often reference reports here
- [[../../Experiments|Mechanism Experiments]] — M1-M13 validations that use these baselines
- [[../../Failure-Modes|Failure Mode Catalog]] — FM-A through FM-H with empirical evidence
- [[../../Architecture/Specs/02-FAILURE-MODES|02-FAILURE-MODES.md]] — canonical failure mode taxonomy
