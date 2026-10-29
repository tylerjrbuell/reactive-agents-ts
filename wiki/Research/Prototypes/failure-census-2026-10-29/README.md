---
type: prototype
status: complete
created: 2026-10-29
tags: [census, failure-modes, harness]
---
# failure-census-2026-10-29

`python3 census.py [--out DIR]` classifies every trace in `load.SOURCES` (dedupes by runId). `python3 tables.py` renders markdown tables from `out/`. Rules: `RULES` and `ROOT_ORDER` in `census.py`. Report: `wiki/Research/Harness-Reports/2026-10-29-failure-mode-census.md`.
Live trace dir is pruned by `packages/trace/src/recorder.ts` and flooded by unit tests; snapshot real runs before re-running if you need reproducibility.
