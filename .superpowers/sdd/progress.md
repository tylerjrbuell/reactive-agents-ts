# Svelte binding + Cortex showcase — SDD Progress Ledger
Plan: wiki/Planning/Implementation-Plans/2026-07-03-agentic-ui-kit-svelte-cortex.md
Branch: worktree-cortex-agentic-ui (off main 0a2a253f)
## Tasks
- S1: createRun core + rewire agent-stream/agent — DONE (report: .superpowers/sdd/task-s1-report.md)
- S2: createResumableRun + rewire structured-stream — DONE (report: .superpowers/sdd/task-s2-report.md)
- S3: createInteractions + runCost/runSteps + testing subpath — complete (b455fa60, 38/38, verbatim). PHASE S DONE.
- X1: cortex server interaction rail — complete (c153ba05, 319/319; +production registration branch for awaiting-interaction pause). NOTE: route tests mock runner → real pause→registry→resume path inspected-correct, NOT e2e-covered at cortex layer.
- X2: InteractPanel + interaction-watcher (op A) — complete (4c864411, 116/116 UI; used raw fetch not createInteractions — binding body-runId shape ≠ cortex path-runId route)
- X3: chat→connectRunStream convergence (op B) + structured preview (op E) — complete (bd8f7949; 4 behavioral unchanged + op-E test, 117/0). Killed 4th event-union copy. ui-core StreamCompleted +toolSummary (mirror-gap fix). FIX ee277a6b: op-E now DISPLAYED (live Structured-output block in ChatPanel) + connection-failure UX restored. 120/0.
- X4: cursor attach/resume (op C) — DEFERRED (plan-sanctioned). Prereq too invasive for this pass: Cortex serves history from own store not framework run_events journal; durable opt-in; createRunAttachEndpoint unwired; fights WS transport. Core showcase (A+B+E) shipped without it. Needs its own effort: durable-always-on + mount attach endpoint + WS coexistence.
## Minor findings
- S1: `packages/ui-core/src/state/run-machine.ts` `reduceRunState`'s `StreamCompleted` case crashed when `event.metadata` was absent (typed required, not guaranteed at runtime) — legacy `smoke.test.ts` fixture omits it. Fixed with a one-line guard (`event.metadata ?? {}`); out-of-scope file touch, flagged in task-s1-report.md.
- S1: `agent.ts`'s pre-existing `smoke.test.ts` mocks a plain single-shot JSON endpoint (non-SSE) — incompatible with `createRun`'s SSE-only wire protocol. Reconciled via a `compatFetch` adapter (passthrough real SSE, synthesize SSE events for legacy JSON) rather than changing the test or dropping the rewire. See task-s1-report.md Deviations.
- S1 LOW (final-review): run.ts drive() theoretical race on rapid run()/cancel() (aborted StreamCancelled could land after new stream starts) — plan-snippet inherited, untested. reduceRunState only guards StreamCompleted.metadata; CostDelta/RunPaused branches still destructure unguarded (not a systemic input boundary).
- S2: the plan's literal `structured-stream.ts` rewire (`run()` returning `Promise.resolve()` immediately) broke the existing `structured-stream.test.ts` — that suite's behavioral tests do `await stream.run(...)` then assert terminal state synchronously (no `settle()`), which only holds if `run()` awaits completion (the pre-rewire implementation drove its own reader loop to completion before returning). Fixed by mirroring `createAgent`'s resolver pattern: `run()` returns a `Promise` resolved when `createRun`'s inner state reaches a terminal status (completed/error/cancelled). No compatFetch shim was needed — the test's mock emits real `data:`-line SSE with `content-type: text/event-stream`, so `connectRunStream` parses it directly.
- X1 review: Spec PASS, Approved. Deviation (awaiting-interaction registration branch) correct+additive+necessary. NON-BLOCKING notes: (1) durable-approvals.ts registry/name now also holds interactions → follow-up rename (durablePauses) + doc update; (2) VERIFICATION GAP — Cortex-layer real path (buildCortexAgent request_user_input → CortexRunnerServiceLive → register → listPendingInteractions → respondToInteraction) NOT e2e-tested (route tests mock runner); symmetric with existing approval rail's posture but RESOLVED: e2e test `6783a59e` proves real pause→register→list→respond→resume WORKS AS-IS (320/0).
- X2 trivial (final-review): interaction-watcher `seen` Set initialized but unused (store set wholesale each poll) — harmless, remove.

## P3 React binding (plan 2026-07-03-agentic-ui-kit-p3-react.md) — executing in this worktree
- R1: react pkg rewire + useRun + DOM harness — complete (1f5af5a3, 8/8; in-test GlobalRegistrator harness, +happy-dom devDep)
- R2: rewire useAgentStream/useAgent onto useRun — complete (4c0788be, 10/0; requestInit threaded, no compatFetch needed, RTL act-deadlock test-idiom fix)
- R3: useResumableRun — complete (900a09df, 1/1)
- R4: useInteractions + AgentPrompt/ChoiceCard/ApprovalGate — complete (e4d5ed69, 3/3; ApprovalGate copy Approve→Run to avoid matcher collision)
- R5: useTaskInbox + TaskInbox — complete (ceb45dbd, 2/2)
- R6: useRunCost/useRunSteps + CostMeter/StepTimeline — complete (12d4646e, 3/3; fixed plan bug: useRunSteps merges start+complete per callId)
- R7: registry + uiTreeSchema + AgentSurface — complete (122945c6, 4/4; security: unknown type→placeholder, no markup/eval)
- R8: AgentDevtools + testing/styles + gate — complete (1a1887a0, 2/2). P3 REACT DONE 28/0 (+AgentSurface/AgentPrompt malformed-tree guard c72580aa, whole-P3 opus review MERGE-READY). (process.env→globalThis for client-only DTS)
