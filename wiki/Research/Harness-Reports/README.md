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
| `integration-control-flow-baseline.json` | `bun run gate:update` | Frozen-state Tier1Baseline, validated against on every CI run (changes need a `BASELINE-UPDATE:` trailer) |
| `integration-control-flow-scenario-health.json` | gate runner | Per-scenario stability metrics |
| `regressions/<id>-<iso>.jsonl` | gate runner (on failure) | Trace archive for any regression |
| `gate-traces/` | gate runner | Full trace data for the gate suite |
| `improvement-ledger.json` | `rax eval gate --ledger`, `h3/verdict.ts --ledger` | COMMITTED verdict record of the harness improvement loop (`rax eval ledger` lists it) |
| `<date>-h3-<slug>/` | `packages/benchmarks/src/h3/run-h3.ts` | H3 results JSON per run (traces stay in gitignored `benchmark-traces/`) |

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

1. **SELECT / VERIFY:** H3 results JSON (`<date>-h3-<slug>/`) is the before/after evidence; `rax-diagnose attribute --all` reads the traces it points at
2. **RECORD:** one `improvement-ledger.json` entry per verdict
3. **Commit:** results + ledger entry are the empirical evidence in commit messages

### Probe tooling

The loop runs on the H3 frozen suite (`packages/benchmarks/src/h3/`) and `rax-diagnose cause|attribute`. The 2026-05..07 skill probe scripts (`task-quality-gate.ts`, `harness-probe*.ts`, `harness-evolve.ts`, `cross-strategy-matrix.ts`, `ri-ablation.ts`, the real-world probe fleet, and others) were retired 2026-11-03; reports that cite them keep their results, and the scripts remain in git history.

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
