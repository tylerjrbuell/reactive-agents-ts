---
title: Content-Aware Projection (#1) — clears the Phase-4 cutover blocker
date: 2026-05-31
branch: overhaul/agentic-core-2026-05-31
feature: ResultStore.preview() + projectResults preview+ref mode
verdict: SHIPS — preview+ref beats legacy on overflow-summarize (faithfulness up, honesty held)
---

# Content-Aware Projection (#1)

The strangler-fig cutover blocker (Phase-4 leg a). `project()`'s overflow branch
used a bare `summarize()` (shape + ref only) → stripped the content the model
needed to summarize → looped / dropped sections (bare-ref 0/2 vs legacy faithful).
Fix: a content-aware bounded `preview()` that replaces bare-ref.

## What shipped
- **`ResultStore.preview(ref, budgetChars)`** — structure-aware bounded preview:
  - markdown-structured content (≥2 headings) → **heading SKELETON** (each heading +
    its lead line; degrades to headings-only, then hard slice) so EVERY section stays
    visible within budget.
  - else → bounded HEAD truncation.
  - both append an honest truncation marker + the ref (recoverable AND actionable by
    reference). Content under budget returns full, no marker noise.
- **`projectResults` overflow branch** now emits `preview+ref` (was bare `summary+ref`).
- Renamed the projection label across trace type + tests.

## The verified bar (read the actual output, not the label)
The assumed bar was "match legacy's faithful 2/2." Reading legacy's actual `=0`
output demolished it: legacy inlined only ~5k of the 57k doc (`"...731 more"`
truncation markers) and its summary covered only **~19/22 sections** — "Common
Pitfalls", "Current Framework Snapshot", "Consumer Skills" appeared NOWHERE in the
log. Legacy's "faithful" grade was lenient (it silently dropped the spread tail
sections). So the real target was not "match legacy" but "cover all sections the
source has" — which a structural skeleton does and a head-truncate (like legacy)
cannot, because the 22 `##` sections are SPREAD to line 694 of 735.

## A/B result (haiku, overflow-summarize, RA_ASSEMBLY 1 vs 0, N=4)
A **section-coverage grade** (`apps/examples/section-coverage-grade.ts`) was built
FIRST — the cohort comparator's "deliverable-produced" only checks a file exists and
would have scored legacy-19/22 ≈ preview-X/22 identically, blessing a dishonest
partial. Applied to both arms:

| arm | coverage (4 runs) | mean tokens |
|---|---|---|
| 0 legacy curate | 19, 20, 19, 19 → ~19.3/22 | ~4039 |
| 1 project + preview+ref | **22, 22, 22, 22 → 22/22** | ~4818 |

- **Faithfulness: preview 22/22 robust** (project() is deterministic → the model sees
  the identical full heading skeleton every run) vs legacy's silent ~19/22.
- **Tokens roughly flat-to-+19%** — the increase is the model faithfully covering 3
  more sections (more output), not waste; preview INPUT is smaller (~2-3k skeleton vs
  legacy's ~5k head). N=1 was actually cheaper (3645).
- **Honesty-gate verdict: B IMPROVES** — deliverable-coverage up, success held, no
  honesty loosened. A faithfulness gain at a modest token cost is a win (honesty-first).

## Verification
- `ResultStore.preview` unit tests 8/8 (structural-covers-all-headings, head-fallback,
  under-budget-full, always-recoverable). Assembly suite 45/0. Reasoning 1574/0. Build GREEN.

## Bound / what's NOT done
This clears **leg (a)** only — overflow-summarize regression on the reactive seam.
**Leg (b)** — `project()` covering non-reactive strategies (plan-execute/ToT/reflexion
assemble via a separate path) + public API — is **#2**, the next cutover step, and is
what still gates flipping `RA_ASSEMBLY` default-on / deleting the legacy builders.

Deferred refinements: (a) window-source fix (mid tier capped at 32768, not haiku's real
200k — a scaffoldProfile-spine #5 policy change, NOT needed here since the structural
preview beats legacy at the current budget); act-ref-overflow token gate (unmeasurable
in the current grid — add a cell if wanted).
