---
type: implementation-plan
status: active
created: 2026-10-29
updated: 2026-10-29
tags: [implementation-plan, planning, goals, loop, schedule, cortex, debt, polish]
spec: "[[2026-10-28-plan-and-goal-primitives]]"
---

# Goals, Loops and Polish — Plan 4

**Goal:** Ship the Phase 3 slice of `2026-10-28-plan-and-goal-primitives` (`/goal`, `/plan`, goal bar), add `/loop` and `/schedule` to Cortex chat, and close the silent-failure debt and unverified claims left by the 2026-10-28 wave.

**Not in scope:** Phase 2 triage (lift-gated, needs its own ablation), Phase 4 strategies-as-policies (blocked on 09 Steps 2–3), W5 τ-bench, W7 MCP server.

## Design decisions

1. **A goal is a supervisor over ordinary turns, not a new run kind.** Segments are chat turns on one session. History, ledger and the live checklist carry over, and `ChatSessionBusyError` already serializes them. No new kernel state.
2. **Verdict = deterministic tiers first, judgment second, `null` when undecided.**
   - Tier 1: criteria that are `regex` / `mustInclude` / receipt `deliverables[]` are checked against the last segment's result. All pass → `achieved`.
   - Tier 2: if any criterion is rubric-only, one checker call (judgment backend, LLM-emulation fallback) returns `achieved | progressing | stalled | blocked`.
   - No model allowed and tier 1 undecided → `goalAchieved: null`. Never guess.
3. **Stall is read from facts, not asked of the model:** no new ledger evidence and no requirement-status transition for `stallAfter` (default 2) consecutive segments.
4. **Budget is checked at segment boundaries only** (segments, cost USD, tokens, wall clock). In-run limits bound each segment. No mid-segment kill. Exhaustion ends the goal as `budget-exhausted`, never silently.
5. **`autoAccept` is off.** `/goal <objective>` produces a proposal (objective, derived criteria, budget). The user accepts it in the goal bar before segment 1 runs.
6. **Loops and schedules fire turns, never bypass guards.** Fire only when the session is idle (`busy` → skip and record `skipped:busy`). Every schedule has a mandatory expiry (default 7 days), a per-session cap (3), and a per-fire cost cap. Results are visible in the session like any turn.
7. **Reuse, don't add:** cron matching reuses `packages/gateway/src/services/cron-parser.ts`. Interval syntax (`5m`, `1h`) compiles to a fixed-interval timer in Cortex.
8. **Observable:** every goal/schedule transition is a bus/stream event (`GoalUpdated`, `ScheduleFired`) persisted in the turn trace. No console logging.

## Types (core, additive)

```ts
GoalCriterion = { id; text; check: { kind: "regex"; pattern } | { kind: "must-include"; value } | { kind: "rubric" } }
GoalBudget    = { maxSegments; maxCostUsd?; maxTokens?; maxWallClockMs? }
GoalVerdict   = "achieved" | "progressing" | "stalled" | "blocked"   // goalAchieved: true | false | null
GoalState     = { id; objective; criteria; budget; status: "proposed"|"active"|"paused"|"achieved"|"stalled"|"blocked"|"budget-exhausted"|"cancelled"; segments; spent; verdictHistory }
```

`TaskContract` is not widened. `GoalCriterion` maps onto its `SuccessCriterion` vocabulary (regex / llm-judge) so there is one oracle vocabulary.

## Tasks

Order: **A → B → C**; D runs in parallel with A–C. Every commit keeps typecheck green and touches one concern. Parallel agents must `git commit -- <paths>` for only their own files (shared-tree sweep hazard).

### Wave A — foundations (parallel)

- **A1 · runtime-warden · pure goal supervisor.** `packages/runtime/src/goal/` : `evaluateGoal(state, segmentResult)` (tier-1 checks, stall, budget → next status) and `pursueGoal({ runSegment, check, state, onUpdate })` generic over a `runSegment` function so Cortex and tests share it. Types live in core. Tests (timeout 15000): achieved by regex; stall after N no-delta segments; budget exhaustion per axis; `null` when undecided; cancel between segments; red-on-cut for each exit path. Gate: typecheck + scoped tests.
- **A2 · runtime-warden · D-2026-10-29-CHILD-COST.** Fold a failed child's spend into the parent's cost/budget at the same boundary as successes. Locate the fold site first (the register's line ref is stale). Failing-child fixture, red-on-cut. Then drop Cortex's `costKnown:false` mitigation only if the fixture proves parity. Otherwise leave it.
- **A3 · cortex (general agent) · schedule store + ticker.** `apps/cortex/server/services/chat-schedule-service.ts`: table `chat_schedules(id, session_id, kind loop|cron, spec, prompt, expires_at, max_cost_usd, runs, last_status)`, minute ticker (single `setInterval`, `.unref()`, cleared in `disposeAll`), idle-only firing through `ChatSessionService.chat`, caps from Decision 6, `ScheduleFired` event persisted. Routes: `POST/GET/DELETE /sessions/:id/schedules`. Tests: fire when idle, skip when busy, expiry, cap, cron match via gateway parser, ticker teardown (no dangling handle).

### Wave B — Cortex surface (after A1, A3)

- **B1 · cortex server · goal service + routes.** Goal table + service wrapping `pursueGoal` with `ChatSessionService.chat` as `runSegment`. Routes: `POST /sessions/:id/goal` (propose), `POST .../goal/accept`, `POST .../goal/pause|resume|cancel`, `GET .../goal`. Goal owns the session while active: user turns during an active goal get a clear 409 naming the goal (not a silent queue). SSE `GoalUpdated`. Restart safety: on boot, active goals become `paused`.
- **B2 · ui-core + Cortex UI.** `GoalUpdated` wire event folded into run/turn state. Commands in `chat-commands.ts`: `/goal <objective>` (propose), `/goal pause|resume|cancel|status`, `/plan` (toggle plan card and to-do dock), `/loop <5m|1h> <prompt>`, `/loop stop`, `/schedule "<cron>" <prompt>`, `/schedule list|rm <id>`. `ChatGoalBar.svelte` above the input: objective, criteria rows (gate-style status), budget meters, accept/pause/cancel. Schedules list in the session menu. Both themes; 420px width.
- **B3 · docs.** `features/cortex.mdx` (commands, goal semantics, honest verdict language, loop/schedule caps), changeset for `@reactive-agents/cortex` and runtime.

### Wave C — verify (after B)

- **C1 · browser verification record** to `wiki/Research/Harness-Reports/2026-10-29-goals-loops-browser-verification.md`: goal propose→accept→achieved on a keyed cheap model; stall and budget-exhausted paths; pause/resume; loop fires and skips while busy; 420px layout both themes. Rebuild `apps/cortex/dist` first (stale-dist trap).
- **C2 · lift check for nothing new:** goals change no default and no model-visible prompt outside a user-started goal, so no ablation is required. State this in the changeset. If segment prompts add a standing frame, test request-identity with goals OFF.

### Wave D — cleanup and debt (parallel to A–C)

- **D1 · kernel-warden · D-2026-10-28-ACT-EXIT.** Route all `act.ts` early-return exits through one state-finalizing helper; pin each dropped field red-on-cut.
- **D2 · runtime-warden · D-2026-10-28-RUNID-STAMP.** Stamp `runId` on `AgentStarted/Completed`; delete the name-shape inference in `makeRunTree` and Cortex persistence; sibling-same-name fixture.
- **D3 · cortex · D-2026-10-28-DOC-FETCH.** Per-session URL doc cache; surface `DocumentIngestFailed` in the Cortex UI.
- **D4 · tools-warden · real built-in schema no-op test** for `normalizeToolSchema` (all registered built-ins deep-equal, zero repairs).
- **D5 · main · wiki/docs truth pass.** Commit or delete the untracked V5 probe scripts (`wiki/Research/Prototypes/todo-guidance-probe-2026-10-28.*`) and record the outcome. Fix spec body "Status: draft" → approved. Update Planning-Index. Verify `builder-api.md` has `observability.checklist` prose and `llm-providers.md` documents `listProviderModels`/`resolveProviderModels` (audit says gaps; commit `1430279c5` may have fixed them: check before editing). Record full `bun test` and `bun run build` counts in Hot.md. Update memory + `.agents/MEMORY.md`.
- **D6 · verification still owed from the last wave** (fold into C1 session): strategy switch in chat, groq/xAI pickers, sub-agent blocks, Beacon live tree, cost survives reload, Run trace tab/export, to-do dock at 420px. Real-TTY TUI checklist check.

## Exit gates

- Scoped tests per task; `bun run typecheck`; `bun run build`; full `bun test --timeout 15000` counts recorded once at the end.
- Honest-claims: docs say a goal verdict is `null` when undecided; no claim that goals improve results (unmeasured).
- Debt rows A2, D1–D3 marked RESOLVED with commit hashes.

## Risks

- **Runaway spend:** mitigated by mandatory budget on goals and schedules, accept-before-run, expiry, per-fire cost cap.
- **Goal vs. user turn collision:** explicit 409 with goal name, plus pause. Revisit queueing only if it proves annoying.
- **Checker cost/noise:** tier 1 deterministic first; the judgment call runs only for rubric criteria.
- **Parallel-agent staging sweeps:** path-scoped commits; re-check `git diff --cached --stat` before each commit.
