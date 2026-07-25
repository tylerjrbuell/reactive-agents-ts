# Observability Unified Run-Tree — Debrief

**Date:** 2026-07-25
**Branch:** `worktree-observability-unified-run-tree` (off `wave-c2-subagent-ledger-merge` @ `145671e6`)
**Plan:** `wiki/Planning/Implementation-Plans/2026-07-24-observability-unified-run-tree-plan.md`
**Spec:** `wiki/Architecture/Design-Specs/2026-07-24-observability-unified-run-tree-design.md`
**Method:** Subagent-driven development (fresh implementer + independent reviewer per task, controller-verified test counts, controller-run E2E against a live Ollama model)

## What shipped

Four verified logging defects, plus one live-updating UX feature, in the observability/logging path (`packages/observability`, `packages/runtime`, `packages/tools`):

| Defect | Symptom | Root cause | Fix |
|---|---|---|---|
| D1 | `verbosity: "minimal"` didn't suppress output — leaked the full phase/tool trace | Two independent live-print paths, neither aware of the 4-tier `VerbosityLevel`: `ObservableLogger`'s own debug/info/warn/error filter (Task 4), and `ObservabilityService`'s structured-logger `liveWriter` (found separately during Task 8's E2E pass, not caught by 3 rounds of Task 4 review) | Both paths now gate their live print on `verbosity !== "minimal"` |
| D2 | A sub-agent printed its own full dashboard mid-parent-stream | Every sub-agent gets its own `ObservabilityService` instance and called `flush()` independently | New `ChildDashboardRegistry` mirrors `sharedEventBus`'s threading pattern; sub-agents run with `emitConsole:false`, their dashboard data rolls up into the root's single end-of-run dashboard as a nested "Sub-agent: `<name>`" section |
| D3 | Duplicate DEBUG `[action]`/`[obs]` lines, one prefixed one not | `subscribeReasoningStreamLogger` was called once per execution-engine invocation (parent AND every sub-agent), all attaching to the same shared `EventBus` with no `taskId` filter — one event fired both listeners | Call site gated to root-only (`!lp`); the shared bus already delivers every descendant's events to the root's single subscription |
| D4 | Each LLM call logged twice in debug mode (74 entries for a 2-agent run) | `ReasoningStepCompleted`'s `.prompt` branch and `LLMExchangeEmitted` both logged the same call | Deleted the `ReasoningStepCompleted` prompt branch; `LLMExchangeEmitted` is the genuine single chokepoint (verified: `.prompt` is set in exactly one place codebase-wide, and that data is a redundant view of what `LLMExchangeEmitted` already captures at a lower layer) |
| — | New: live-updating, collapsible one-line sub-agent summary in the TTY status renderer | — | `AgentStarted`/`AgentCompleted` subscription in `status-renderer.ts`, with a `parentAgentId` guard distinguishing the root's own event from a real sub-agent's |

## Before/after evidence (live Ollama, `gemma4:latest`, run from inside the repo)

- **Minimal:** 64 lines → **5 lines** (provider line + final result only).
- **Normal:** 2 separate `Agent Execution Summary` boxes (one mid-stream from the sub-agent, one at the true end) → **exactly 1 box**, sub-agent rendered as a nested section within it.
- **Verbose:** confirmed zero prefixed/unprefixed duplicate `[action]`/`[obs]` pairs at the same instant (the separate, pre-existing "═══ Logs ═══" end-of-run replay is expected and unrelated to D3).
- **Debug:** 74 `model-io` entries (2-agent run) → **4 entries** (2 live + 2 in the end-of-run replay = 2 real calls, one per agent), zero `model-io:reactive:*`/`:main` tags remaining (the deleted emission path).

## Process notes and lessons

- **`bun test` does not typecheck.** Two Task-4-originated type/field errors (a `string`-vs-union cast gap, and an invalid `logging` field name that was silently ignored at runtime) shipped through 3 approved review rounds because every verification ran `bun test` only. Both were caught by Task 7's own build diligence and Task 8's typecheck sweep, not by the review process itself. **Going forward for this codebase: `bun test` proves behavior; `bunx tsc --noEmit -p packages/<pkg>/tsconfig.json` (or `turbo run build`/`turbo run typecheck`) is required separately to catch type-only regressions.**
- **A 5th D1 leak path survived Task 4 entirely** (`ObservabilityService`'s own `liveWriter`, independent of `ObservableLogger`) and was only found via a real end-to-end run through the public `ReactiveAgents.create()` builder — unit tests that construct services directly, or that only exercise one of the two logging systems, cannot catch a defect that spans both. This is the strongest argument in this branch's history for keeping E2E verification in the loop even when unit coverage is green.
- **Bun's bare-specifier resolution depends on the *script's* location, not the working directory it's launched from.** A test script placed outside the repo (e.g. `/tmp/...`) can silently resolve `reactive-agents` from the published npm package in bun's global cache instead of the local workspace — producing a plausible-looking false positive that looks exactly like the original bug. Caught mid-investigation by cross-checking with a script placed inside the repo; cost real time before recognition. Always place probe scripts inside the repo tree.
- **Isolation-parameter discipline for dispatched subagents:** passing `isolation: "worktree"` to an implementer already working inside a dedicated plan worktree creates a second, unrelated worktree/branch and strands its commit there. One task in this plan required a cherry-pick + branch cleanup to recover. Never pass `isolation: "worktree"` when the dispatch prompt already specifies a working directory.
- **Broad `git add` risk:** a fix subagent accidentally committed ~227,000 lines of unrelated scratch cache files (a graphify exploration trial's output) via `git add -A`. Caught before review via `git status`/`git show --stat` on every commit; fixed with `git reset --soft` + selective restore. Every subsequent dispatch was explicitly told to stage only named files.
- **Reviewer verdicts of "Approved" sometimes still carry non-blocking Important findings** (e.g. a doc comment overclaiming a guarantee the code doesn't fully provide, or a real-but-pre-existing-and-out-of-scope discovery). These were logged in the SDD ledger for this final-review triage rather than either dismissed or treated as automatic blockers — see "Deferred, not fixed" below.

## Deferred, not fixed in this plan (logged for follow-up)

1. **`builder/to-config.ts:184` + `agent-config.ts:642`** — a 4th instance of the "stale default leaks as if explicit" pattern (same class as the 3 fixed in Task 4), reachable via the `builder.toConfig()` → `ReactiveAgents.fromConfig()` config round-trip. Confirmed live: a round-tripped agent that never called `.withObservability()` silently loses ALL console output. Pre-existing, untouched by this plan's diffs, but made consequential by D1's fix (before D1, the flag corruption was cosmetic). **Recommend as an immediate fast-follow.**
2. **`ChildDashboardRegistry` is per-built-agent, not per-run.** Sequential `.run()` calls on one built agent are safe (each drain clears state before the next run), but concurrent/overlapping `.run()` calls on the same built agent instance would share one registry and misattribute sub-agent entries. Not a regression (pre-fix behavior over-reported to both runs instead of dropping one). Would need a `rootRunId`-keyed registry to close properly.
3. **Two Minor gaps in Task 7's sub-agent name fix:** the second dispatch site (`local-agent-tools.ts`'s static `.withSubAgent()` path) is fixed but unpinned by a test; and `execution-engine.ts`'s actual `eb` argument to `makeStatusRenderer()` is unpinned (a wiring test constructs the renderer directly rather than verifying the real call site passes `eb` — a silent-kill seam per the project's "wire it AND pin it" doctrine).
4. **Root agent's own display name still carries an epoch-timestamp suffix** (`builder.ts`, `${name}-${Date.now()}`) — same display-name defect class Task 7 fixed for sub-agents, one level up. Scoped out because routing the root through the explicit `agentDisplayName` field would bypass an existing `^cortex-desk-\d+$` placeholder filter; needs its own design decision, not a copy-paste of Task 7's fix.
5. **A completed sub-agent's collapsed line leaves two permanent scrollback lines** (the running `●` line and the frozen `✓`/`✗` line), not one as originally specified — a consequence of the accepted "no per-line redraw region" simplification. Cosmetic.

## Verification (final state)

- `packages/observability`: 228 pass / 0 fail.
- `packages/runtime`: 1374 pass / 1 skip / 0 fail.
- `packages/tools`: 959 pass / 0 fail.
- `bunx tsc --noEmit` clean on all three packages.
- `bunx turbo run build` and `bunx turbo run typecheck`: all tasks successful.
- Live E2E against `gemma4:latest` via Ollama, all four verbosity modes, run from inside the repo: all four defects confirmed fixed (see table above).
