# Bundle: replay-determinism-revalidation
Date: 2026-08-16
Budget: 30 min
Issues: #30, #53

## Baseline
- `bun run build`: 37/37 (cached)
- `packages/replay/` suite: 30 pass / 0 fail (pre-existing, unchanged by this bundle)

## Re-verification note (neither issue carried `verified-by:` evidence)

- **#30** (Replay E2E determinism integration test): grepped for the file the
  issue names (`tests/integration/replay-e2e.test.ts`) — doesn't exist at
  that path, but `packages/replay/src/e2e.test.ts` (landed via PR #196,
  refined by #197, both already on `origin/main` before this session)
  satisfies the exact acceptance criteria in the issue body: records a
  seeded task, asserts byte-identical replay on the same seed, mutates a
  recorded tool result and asserts the replay diverges at exactly one
  expected point. Already done — this bundle is a close-with-evidence, not a
  code change.
- **#53** (Snapshot/Replay determinism re-validation): re-ran the full
  replay-determinism suite cluster and published a dated report to
  `wiki/Research/Harness-Reports/`. The issue's literal scope ("against
  integrated v1.0 codebase") doesn't fully apply yet (v1.0 hasn't landed) —
  treated this as a periodic checkpoint per the report's own verdict, not a
  final closure of the v1.0 gate.

## Acceptance criteria (per issue)
- #30: cite the existing test + its two assertions (byte-identical + exact
  divergence point) as evidence; close with a comment, no code change.
- #53: publish a results report covering every currently-existing
  determinism-pinning suite (replay, replay-golden, replay-lane,
  t0-deterministic, north-star-gate), with pass/fail counts and a verdict.

## Execution units (ordered)
1. **Unit 1 (~10 min):** re-run `packages/replay/` + the determinism-adjacent
   benchmark/gate suites; confirm 0 failures.
2. **Unit 2 (~15 min):** write the report
   (`wiki/Research/Harness-Reports/replay-determinism-revalidation-2026-08-16.md`).
3. **Unit 3 (~5 min):** close both issues with evidence comments.

## Risk register
- None — no production code touched. The only risk is mis-scoping #53's
  closure (v1.0 vs current codebase); mitigated by stating the scope
  explicitly in the report's verdict rather than silently over-claiming.

## Verification protocol (cross-cutting)
- `bun test packages/replay/ packages/benchmarks/tests/replay-golden.test.ts packages/benchmarks/tests/replay-lane.test.ts packages/benchmarks/tests/t0-deterministic.test.ts packages/testing/tests/gate/north-star-gate.test.ts`

## Out-of-scope (explicit)
- #188 (AgentStreamEvent 3-way divergence) — self-describes as blocked on a
  build-graph change (`@reactive-agents/svelte` carries no
  `@reactive-agents/*` deps); needs its own scoping pass first, not a fit for
  this bundle.
- #31/#32 (Langfuse/Braintrust exporters) — new external-SDK integrations,
  sizable scope, not cohesive with the replay-determinism theme.
