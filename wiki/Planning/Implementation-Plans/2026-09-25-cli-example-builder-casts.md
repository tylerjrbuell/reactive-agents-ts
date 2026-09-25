---
type: implementation-plan
status: completed
created: 2026-09-25
completed: 2026-09-25
authored-by: opencode
related: [[Planning/Planning-Index]]
tags: [backlog, priority-p1, builder, type-safety]
---

# Bundle: cli-example-builder-casts
Date: 2026-09-25
Budget: 90 min
Issues: #225
Bundle tracker: #229

## Grounding

Issue #225 is open, unassigned, priority:p1, and has a `Verified-by` command. The
current source has **9**, not 8, `ReactiveAgents.create() as any` occurrences in
the four cited files; `hitl-approval-gate.ts:111` was omitted from the issue's
location list. One stale probe was found and removed: the example checked for
`.withA2A()` even though that builder method exists; this did not test cassette
support.

Code inspection separates them into two groups:

- **Unnecessary casts on ordinary supported builder chains (3):**
  `apps/cli/src/commands/demo.ts:234` and
  `apps/examples/src/multi-agent/a2a-cassette-replay.ts:90,96`. Their chains use
  methods present on `ReactiveAgentBuilder`. Removing the CLI cast exposed the
  underlying defect: `ProviderInfo.provider` was an unconstrained `string`, and
  the Gemini detection branch returned unsupported provider name `"google"`;
  it now uses the exported `ProviderName` type and returns `"gemini"`.
- **Stale probe removed (1):** `a2a-cassette-replay.ts:81` checked for
  `.withA2A()`, which already exists at `packages/runtime/src/builder.ts:734`;
  this did not test cassette support and could never report that gap accurately.
  Cassette absence remains covered by the explicit `@reactive-agents/replay` and
  `@reactive-agents/a2a` surface checks earlier in the example.
- **Deliberate capability probes (5):** the three `with-session-persistence.ts`
  occurrences probe/build through the currently absent `withSessionPersistence`
  method, and the two HITL occurrences probe/build through absent
  `withInteractionMode`. These are intentionally runtime-conditional xfail
  examples, not ordinary builder inference sites.

## Acceptance criteria (per issue)

- #225: remove `as any` from the three ordinary supported builder chains, delete
  the stale `.withA2A()` existence probe, type the CLI provider against
  `ProviderName` and correct Gemini to `"gemini"`, prove the CLI and edited
  example typecheck, and record why five remaining casts are intentional
  capability probes. Re-run the exact-site search and report the resulting count
  (9 → 5).

## Execution units (ordered)

1. **Unit 1 (≤30 min):** remove the cast from the CLI live-demo chain and the two
   A2A cassette example build chains; narrow `ProviderInfo.provider` to the
   builder's union and fix the unsupported Gemini alias. Files:
   `apps/cli/src/commands/demo.ts`,
   `apps/examples/src/multi-agent/a2a-cassette-replay.ts`. Remove the stale
   `.withA2A()` check, which did not check cassette support. TypeScript
   compilation is the regression gate; it exposed the invalid provider before
   the correction.
2. **Unit 2 (≤30 min):** update `rax demo` documentation and unreleased notes, run
   targeted/workspace verification, review the diff, and update #225 with the
   verified classification and corrected count.

## Risk register

- A chain may rely on a genuine inference workaround → remove one cast at a time
  and run the owning app's typecheck immediately.
- Removing the CLI cast may uncover incorrect provider values → use the builder's
  exported provider union as the source of truth and correct the discriminator.
- The examples intentionally exercise APIs that may not exist yet → preserve
  those dynamic probes and their current failure behavior; remove only probes
  that no longer match the source API.
- Baseline workspace failures can obscure regressions → capture build/test/
  typecheck baseline on the bundle branch before editing and compare after.

## Verification protocol (cross-cutting)

- `bun run --cwd apps/cli typecheck` and `bun run --cwd apps/cli build`
- `bunx tsc --ignoreConfig --noEmit --target ES2022 --module ESNext
  --moduleResolution bundler --strict --skipLibCheck --verbatimModuleSyntax
  --types bun-types --esModuleInterop --rootDir .
  apps/examples/src/multi-agent/a2a-cassette-replay.ts`
- `bun run build`, `bun test --timeout 15000`, and `bun run typecheck`
- Re-run `rg -n "ReactiveAgents\\.create\\(\\)\\s+as any"` across the four
  issue files; confirm five remaining sites all belong to the capability probes.
- Review the final diff and check no unrelated changes entered the bundle.

The broad `apps/examples/tsconfig.json` check currently reports diagnostics in
unmodified files (advanced examples, demos, reasoning probes, and OTel import
identity); it reports no error in `a2a-cassette-replay.ts`. The edited example
also passes the direct single-file compiler command above.

## Final verification

- `bun run build`: **38/38 tasks successful**; docs built 95 pages and validated
  internal links.
- `bun run typecheck`: **68/68 tasks successful**.
- `bun run --cwd apps/cli typecheck` and `bun run --cwd apps/cli build`: pass.
- Direct TypeScript check of `a2a-cassette-replay.ts`: pass.
- Direct offline execution of the A2A cassette example returns its expected
  `passed: false` while reporting that cassette support is absent.
- `bun test --timeout 15000` before local integration: **9,593 pass / 20 fail /
  25 skip / 4 todo**, identical to baseline. After local integration, one
  additional workspace-order failure appeared in the untouched
  `packages/observability/tests/logging/effect-logger-bridge.test.ts` (9,592
  pass / 21 fail / 25 skip / 4 todo). The file passes alone (4/0), and the full
  observability package passes (234/0); the other 20 baseline failures are the
  two cast-ceiling checks and 18 Docker-dependent timeouts.
- Issue-location recheck: exact `ReactiveAgents.create() as any` search now
  returns **5** sites (was 9), all in the deliberate missing-capability probes.
- No change to the public builder API; the CLI demo now uses a valid Gemini
  provider value and precise `ProviderName` typing.

## Integration

Fix commit `5ec4dd63` was merged locally to `dev` as `6bf54034`. No PR was opened
and no remote push was made: `origin/dev` has six commits absent locally while
local `dev` contains 75 commits absent from `origin/dev`, so publishing this
branch would include unrelated local history. #225 and tracker #229 were closed
with verification comments. Neither issue had a project-board item, and the
GitHub token lacks `read:project` scope to inspect or move board cards.

## Baseline

Captured on `bundle/cli-example-builder-casts` before source edits:

- `bun run build`: **38/38 tasks successful**.
- `bun test --timeout 15000`: **9,593 pass / 20 fail / 25 skip / 4 todo**
  across 1,265 files. Existing failures: 2 `as unknown as` ceiling tests and
  18 Docker-dependent CLI/tools tests timing out in this environment.
- `bun run typecheck`: **68/68 tasks successful**.

## Out-of-scope (explicit)

- Do not alter the five dynamic capability-probe casts or implement the missing
  builder capabilities they probe.
- Do not change `demo.ts`'s separate result-metadata cast at line 256.
- Do not make a public builder API change. Add a patch changeset for the
  user-visible `rax demo` provider correction.
