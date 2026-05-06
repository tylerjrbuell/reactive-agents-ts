---
type: directory-readme
tags: [research, prototypes, spikes]
---

# Prototypes — Spike Research Directory

> **Purpose:** Spike research — small, hypothesis-driven prototype scripts that test a question about the framework before committing to an architectural fix. Each spike produces both executable code and a written outcome.

## Origin

Moved from `/prototypes/` to `wiki/Research/Prototypes/` in May 2026 consolidation. Now part of the wiki knowledge graph alongside related debriefs, experiments (M-series), and failure modes.

## Convention (per Research Discipline Rule 5)

Every spike gets:

1. **A prototype script** — `pNN-<short-description>.ts` at this directory's root
   - Self-contained TypeScript that runs via `bun run wiki/Research/Prototypes/pNN-*.ts`
   - Header comment block: `HYPOTHESIS`, `NULL HYPOTHESIS`, `METHOD`, `EXPECTED OUTCOME`
   - Must be reproducible: pinned model + seed (where applicable) + scenario

2. **Per-spike findings** — `RESULTS-pNN.md`
   - Hypothesis verdict (CONFIRMED / FALSIFIED / INCONCLUSIVE)
   - Quantitative findings (run counts, fabrication rate, accuracy lift, token cost)
   - Qualitative observations (why the hypothesis was right/wrong)
   - Concrete next-spike priorities (chained discovery)

3. **One paragraph in `RESEARCH_LOG.md`** — running record of every spike
   - Question, outcome, key learning, next move
   - Per Research Discipline Rule 5: every spike, regardless of outcome
   - This log is what prevents re-running the same spike six months later

## Current Spikes (chronological)

| Spike | Date | Model × Scenario | Verdict | Result file |
|-------|------|------------------|---------|-------------|
| p00 | 2026-04-27 | cogito:8b × rw-2 × 5 runs | CONFIRMED (different direction) | [[RESULTS-p00]] |
| p00v2 | 2026-04-28 | qwen3:4b × rw-2 × 5 runs | EXPANDS p00 finding | [[RESULTS-p00v2]] |
| p01 | 2026-04-29 | bare + verification gate | CONFIRMED for cogito | [[RESULTS-p01]] |
| p01b | 2026-04-29 | bare + verification (cogito-only) | (deepens p01 evidence) | [[RESULTS-p01]] |
| p02 | 2026-04-30 | bare + verify + retry × 3 | NEGATIVE — 0/5 recovery | [[RESULTS-p02]] |
| p03 | 2026-05-01 | qwen3:14b thinking bug repro | (in progress) | — |

See [[RESEARCH_LOG]] for the canonical narrative.

## Naming

- **`pNN-<short-description>.ts`** — prototype script (NN is sequential, two digits)
- **`pNNv<v>-<…>.ts`** — variant of an earlier spike (different model, scenario, or methodology)
- **`pNN<letter>-<…>.ts`** — sister spike (closely related, runs in same family)

Examples:
- `p00-bare-vs-harness.ts` — original
- `p00v2-competent-bare-vs-harness.ts` — repeat with capable model
- `p01-bare-with-verification.ts` — original
- `p01b-bare-with-verification-cogito.ts` — sister (cogito-specific)

## Running a Prototype

```bash
# All prototypes are self-contained; run from repo root
bun run wiki/Research/Prototypes/p00-bare-vs-harness.ts

# Models are usually configurable via env var
PROBE_MODEL=qwen3:4b bun run wiki/Research/Prototypes/p00v2-competent-bare-vs-harness.ts
```

Output formats:
- Console: streaming run-by-run results
- File: structured JSON appended to `wiki/Research/Harness-Reports/<spike-name>-<timestamp>.json` (if the spike uses `REPORTS_DIR`)

## Cross-link to the knowledge graph

Spike research connects to:

- **Failure Modes** — spikes often surface or validate FMs. Update `wiki/Failure-Modes/FM-<X>-*.md` with the spike result.
- **Mechanism Experiments** — graduating a spike into a tested mechanism becomes an `wiki/Experiments/M<N>-*.md` note.
- **Architecture Specs** — `wiki/Architecture/Specs/02-FAILURE-MODES.md` and `03-IMPROVEMENT-PIPELINE.md` cite specific spike files; keep cross-references current.
- **Decisions** — if a spike informs an architectural decision, link from `wiki/Decisions/`.
- **Debriefs** — when a spike's finding ships as a fix, write a debrief at `wiki/Research/Debriefs/`.

Use Obsidian wikilinks: `[[Research/Prototypes/RESULTS-p00|p00 results]]`.

## When to Spike vs Build

Per Research Discipline:

- **Spike (here)** when: hypothesis is unverified, fix scope is uncertain, multiple architectural options exist, or empirical data is needed before designing.
- **Build (in `packages/`)** when: hypothesis already validated by a spike, fix scope is clear, only one reasonable architecture, and existing tests cover the surface.

A spike that ships without a paragraph in `RESEARCH_LOG.md` violates Rule 5 — the discipline that keeps the project from re-running the same experiment six months later.

## Related

- [[../Debriefs|Engineering Debriefs]] — post-feature notes from shipped fixes (often follow up on spikes)
- [[../Harness-Reports|Harness Reports]] — phase validations + baselines (where spike measurements land as JSON)
- [[../../Experiments|Mechanism Experiments]] — M-series validations (graduated spikes)
- [[../../Failure-Modes|Failure Mode Catalog]] — FM-A through FM-H (cited by spikes)
- [[../../Architecture/Specs/01-RESEARCH-DISCIPLINE|01-RESEARCH-DISCIPLINE.md]] — the 12 rules; Rule 5 is the most-cited
