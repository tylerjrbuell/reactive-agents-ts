# Agentic UI Kit — Framework Gap Log

Standing order (spec §10): every framework friction hit while building the UI kit
gets an entry here with production context. Format per entry:

## GAP-N: <title>
- **Hit while:** <task / what you were doing>
- **Expected:** <what the framework should have offered>
- **Actual:** <what exists / what you had to do instead>
- **Severity:** blocker | workaround | papercut

## GAP-1: act.ts intercept template omitted the offer-flag gate
- **Hit while:** Task 9 — wiring the `request_user_input` durable pause into act.ts.
  The brief's literal template (mirroring the approval-gate block) matched on
  `normalizedPendingCalls.find((c) => c.name === REQUEST_USER_INPUT_TOOL_NAME)`
  with no check of `input.metaTools?.userInteraction`.
- **Expected:** the intercept should only fire when the feature was actually
  enabled for the run (same flag think.ts checks before offering the tool
  schema) — otherwise "flag off" and "flag on" are indistinguishable at the
  act.ts seam, since a scripted/deterministic test model can emit a tool call
  by name regardless of what was offered.
- **Actual:** added `input.metaTools?.userInteraction === true` as a guard on
  the `interactionCall` lookup in act.ts (mirroring the `tc.name === "brief" &&
  input.metaTools?.brief` pattern already used a few lines below for meta-tool
  registry gating). Without this, the "tool NOT offered when flag off" test
  case is unfalsifiable — the intercept would pause unconditionally on tool
  name alone.
- **Severity:** papercut (caught by the required "not offered" test case; would
  have been a real gating bug if shipped as literally templated).

## GAP-2: sentinel deliverable reason is a two-place closed union
- **Hit while:** Task 9 — adding `"awaiting_interaction"` as a new
  `sentinelDeliverable(reason)` value in `packages/core/src/contracts/
  deliverable.ts`.
- **Expected:** one string-literal union to extend.
- **Actual:** the reason string is declared TWICE — once as the
  `sentinelDeliverable()` function parameter type, and again (independently)
  as the `Deliverable` discriminated union's `sentinel` branch `reason` field.
  Extending only the function signature type-checks fine at the call site but
  fails `tsup`'s DTS build with a mismatched-literal error, because the
  function's return type widens against the (unextended) `Deliverable` union.
  Both must be updated together; also updated `deliverableToContent`'s
  `sentinel` reason switch for a matching human-readable message ("Run
  paused — awaiting human input.") alongside the existing `awaiting_approval`
  case, otherwise the new reason silently falls into the generic "Task
  complete." default.
- **Severity:** papercut.

## GAP-3: this worktree's `tsc --noEmit` silently resolves cross-package
  imports to the MAIN REPO's stale `dist/`, not the worktree's own source
- **Hit while:** Task 9 — running `cd packages/reasoning && bunx tsc --noEmit
  -p tsconfig.json` per the verification step.
- **Expected:** tsc checks the worktree's own source changes (this worktree
  lives at `.claude/worktrees/agentic-ui-kit/`, a sibling checkout of `main`).
- **Actual:** no package in this worktree has a locally-built `dist/`
  (gitignored, never built here). `packages/*/tsconfig.json` sets `"paths":
  {}`, which — per TS's extends semantics — REPLACES (does not merge with)
  the root tsconfig's `@reactive-agents/*` → `./packages/*/src/index.ts` path
  mapping, so cross-package imports fall back to plain node_modules
  resolution. The worktree's own `node_modules/@reactive-agents/<pkg>` symlink
  points at a `dist/` that doesn't exist locally, so TS's ancestor-directory
  walk continues PAST the worktree boundary and resolves to the outer
  checkout's `node_modules/@reactive-agents/<pkg>` → real repo's
  `packages/<pkg>/dist/` — a build from BEFORE this worktree's changes
  existed. Confirmed via `--traceResolution`: reported "no exported member"
  errors were real (main-repo dist genuinely lacks Task 8/9's new exports) but
  MISLEADING — they don't reflect this worktree's source at all, and would
  have persisted even with fully correct worktree code. Fix: run `bun run
  --filter=@reactive-agents/<pkg> build` locally for every package this
  worktree changed (`core`, `tools` for this task) BEFORE trusting `tsc
  --noEmit` inside a nested worktree — the local `dist/` then wins the
  ancestor walk before it escapes to the main checkout.
- **Severity:** workaround (costs real debugging time on every task in this
  worktree that touches a cross-package export until dist is (re)built
  locally; will recur for Task 10+ unless the workaround becomes routine).

## GAP-4: durable pause resume re-think requires manual status/message reconstruction
- **Hit while:** Task 10 — resuming a run that paused for `request_user_input`.
  The kernel `terminate()` sets `status:"done"` + a sentinel output for the
  pause (same as `awaiting-approval`), and the paused checkpoint captured at
  `iterate-pass.ts` serializes that `done` state. On resume the runner uses
  `resumeState` VERBATIM, so the main loop's `while (status !== "done")` guard
  never runs and no re-think happens — the run would return the pause sentinel.
- **Expected:** the approval-rail re-entry (`runner.ts:425`) to be a working
  template for "inject decision, then continue the loop". It is NOT: the
  approve/deny e2e (`approve-deny-resume.test.ts`) uses `injectPause` onto a
  COMPLETED run's checkpoint, so it never exercises re-think after a REAL pause.
  The approval "observe" branch appends only a `makeStep("observation", ...)`,
  which `fromKernelState` (the prompt assembler) IGNORES — it builds the
  EventLog purely from `state.messages` (goal + assistant tool_calls +
  tool_result), never from `state.steps`.
- **Actual:** the interaction re-entry had to (a) reset `status:"thinking"` +
  clear `output`/`terminatedBy` so the loop re-runs, and (b) synthesize the
  assistant-call + `tool_result` message pair on `state.messages` (the act gate
  pauses BEFORE `assembleConversation`, so no record of the call exists) so the
  human's answer actually reaches the LLM prompt. A bare observation step is
  invisible. This is a latent bug in the approval "observe"/real-pause path too
  (masked by the injectPause test); flagged, not fixed (out of scope).
- **Severity:** workaround (the approval rail is a structural template but not a
  behavioral one for real pauses — cloning it literally produces a run that
  resumes but silently drops the injected value).

## GAP-5: brief's example builder API (`new ReactiveAgentBuilder("name")`) does not compile
- **Hit while:** Task 10/11 — the brief's verbatim test code constructs
  `new ReactiveAgentBuilder("interaction-e2e")`, passing a name to the
  constructor.
- **Expected:** either the constructor to accept a name, or the brief to use the
  real API.
- **Actual:** `ReactiveAgentBuilder` has no explicit constructor (0 args); the
  name is set via `.withName(...)`. Bun ignores the extra runtime arg so tests
  PASS under `bun test`, but `tsc --noEmit` errors `TS2554: Expected 0
  arguments, but got 1`. Adapted the tests to `new ReactiveAgentBuilder()
  .withName(...)`. Papercut, but a trap: green `bun test` hid a type error until
  the tsc gate.
- **Severity:** papercut.

## GAP-6: no run-handle-before-first-event primitive on `runStream` (Task 13)
- **Hit while:** Task 13 — journaled SSE endpoint needs the durable `runId` to
  open a per-run journal BEFORE serializing event 1 (seq must start at 1 on the
  first event). `runStream` events do not carry `runId` until `StreamCompleted`
  (stream-types.ts:29, and even then only on the pause paths).
- **Expected:** a way to learn the durable runId at run-setup time.
- **Actual:** added an additive, opt-in `onRunId?: (runId) => void` option threaded
  `runStream → _runStreamImpl → engine.executeStream → makeExecuteStream`, fired
  synchronously right after `runId` is computed in execute-stream.ts (durable path
  only, before `createRun`). The endpoint pulls the first event via
  `iterator.next()` (which drives the generator into `runPromise(executeStream)`,
  where `onRunId` fires) THEN `await journalReady` — no Promise.race. Fixed
  additively; backward-compatible (every existing caller still compiles/behaves).
- **Severity:** missing-primitive (now filled).

## GAP-7: durable `StreamCompleted` did not carry `runId` on non-paused completion (Task 13)
- **Hit while:** Task 13 attach test — `all.at(-1).e.runId` was `undefined` for a
  normal (non-paused) durable run, so the client had no id to attach/replay with.
- **Expected:** every durable `StreamCompleted` to expose its runId.
- **Actual:** execute-stream only spread `runId` inside the `paused` /
  `pausedInteraction` branches. Added an unconditional
  `...(runStoreCtx !== undefined ? { runId } : {})` on the durable path. Field was
  already optional on the event type — backward-compatible.
- **Severity:** missing-field (now filled).

## GAP-8: `identity` did not reach the durable run row from the streaming path (Task 13)
- **Hit while:** Task 13 inbox test — per-identity filtering needs `runs.user_id`
  populated, but the streaming write path (execute-stream inline `store.createRun`)
  never passed userId/orgId, and `agent.listRuns` only accepted `{status?}` (not
  `{userId?}`), so it could not filter by owner.
- **Expected:** identity threads end-to-end (run creation + list filter).
- **Actual:** added additive `identity?: {userId; orgId?}` option threaded the same
  path as `onRunId`, spread into the inline `createRun`; extended `agent.listRuns`
  + `listDurableRuns` to accept `userId?` (store.listRuns already supported it from
  Task 7). Backward-compatible.
- **Severity:** missing-plumbing (now filled).

## GAP-9: per-call `RunStoreLive` layer opens the SQLite file per journal op (Task 13)
- **Hit while:** Task 13 — `openJournal` constructs a fresh `RunStoreLive(dbPath)`
  per `append`/`list`/`status`, opening the db each time. Mirrors the existing
  per-call idiom in engine/durable-resume.ts (listDurableRuns / markRunStatus /
  getPendingApprovalAt all do the same), so kept for consistency in v1.
- **Expected (future):** a pooled/cached store handle reused across ops.
- **Severity:** perf-debt (measurable under load; fine for v1 + tests).

## GAP-10: `ConnectOptions.fetchImpl` typed as `typeof fetch` is over-strict (Task 14)
- **Hit while:** Task 14 round-trip test — the runtime test injects a mock fetch and
  annotates it as `typeof fetch` (per the brief). Under Bun's lib types, `typeof fetch`
  carries a static `preconnect` property, so a plain arrow function is NOT assignable:
  `tsc` errored `Property 'preconnect' is missing`. The DOM `fetch` type has no such
  requirement, so this only bites Bun/Node-typed consumers of the injectable seam.
- **Expected:** a dependency-injection fetch seam should accept any minimal
  `(input, init?) => Promise<Response>` — the whole point is to substitute a mock.
- **Actual:** relaxed `ConnectOptions.fetchImpl` from `typeof fetch` to a new exported
  `FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>`.
  Global `fetch` stays assignable (looser target), the `?? fetch` default still holds,
  and consumers no longer need a cast. Additive/backward-compatible; `FetchLike` is now
  exported from `@reactive-agents/ui-core`.
- **Also noted (test-harness, not a framework gap):** the brief's mock wrappers do
  `new Request("/api/agent")`, which the raw `Request` constructor rejects (relative
  URL) — unlike a browser `fetch`, which resolves against the page origin. Fixed in the
  test by resolving with `new URL(String(input), "http://ra.test")` (mirroring the
  brief's own `attachFetch`). No source change needed.
- **Severity:** DX/type-ergonomics (now fixed at source; no wire/protocol change).

## GAP-11: interaction/approval endpoints have no owner-authorization check — MUST gate before public deploy
- **Hit while:** whole-branch review of Task 13/14's server endpoints
  (`createInteractionEndpoint` / `createApprovalEndpoint`,
  `packages/runtime/src/server/endpoints.ts`).
- **Expected (pre-public-deploy):** a caller can only answer an interaction or
  decide an approval gate for a run they own — the resolved identity from
  `opts.identify` must equal the run's stored `userId` before
  `respondToInteraction`/`approveRun`/`denyRun` are invoked.
- **Actual (current v1 scope, spec §4.5.1):** both endpoints take `runId` from
  the POST body with NO ownership check at all. Any caller who knows (or
  guesses/enumerates) a `runId` can answer another user's pending interaction
  or approve/deny that user's spend-gated tool call — a real cross-tenant
  authorization hole once these endpoints face the public internet. Scoping
  this is deliberately deferred to P5 (do not implement yet) but MUST land
  before any public deploy: add `identify` to `AgentEndpointOptions`-equivalent
  options for these two endpoints and compare `identity.userId ===
  run.userId` (404/403, not leaking existence) before mutating.
- **RESOLVED (2026-07-02):** the owner-authorization part of this gap is
  shipped. `createInteractionEndpoint`, `createApprovalEndpoint`, and
  `createRunAttachEndpoint` now accept an optional `RunOwnerGuardOptions =
  {identify?: IdentityResolver}` (additive; no-arg / `(agent)`-only call form
  still compiles and behaves identically — verified by the pre-existing
  `endpoints.test.ts` suite). A shared `resolveRunOwnerGuard(agent, req,
  identify, runId)` helper (opens `RunStoreLive(dbPath)` via
  `agent.getDurableInfo()`, same Effect idiom as `journal.ts`/
  `durable-resume.ts`, and reads `getRun(runId).userId`) is applied: for
  interaction/approval, AFTER body parse (need `runId` from the body first)
  but BEFORE `respondToInteraction`/`approveRun`/`denyRun`; for attach, before
  replaying. Unresolved identity → 403 `{error:"unauthorized"}`; unknown run →
  404 `{error:"not found"}`; a run with a stored owner that mismatches the
  resolved identity → 403 `{error:"forbidden"}` (mutation/replay never
  invoked); a run with no stored owner (legacy/unowned) or a matching owner →
  proceeds as before. No `identify` configured → completely unchanged (open)
  behavior. New regression coverage in
  `packages/runtime/tests/server/endpoints-authz.test.ts`: wrong-identity
  403 leaves the interaction pending / the approval run paused; correct-owner
  succeeds; unauthenticated (`identify` resolves `null`) gets 403. Full
  `packages/runtime` suite green except the 2 pre-existing `model routing`
  network-dependent failures (unrelated, documented elsewhere).
  The shared-anonymous-bucket and `LimitExceeded`-over-200 notes below remain
  open documentation items (not addressed by this fix).
- **Also noted — anonymous-bucket foot-gun:** when no `identify` resolver is
  configured, EVERY caller collapses to the single shared `" anonymous"` key
  in `guards.ts` (`ANON`) — the whole anonymous population shares one bucket
  (default `anonymous: {runs: 3, window: "1h"}`), so the entire public/unauthed
  surface of a deployment gets rate-limited together (one loud anonymous
  client can lock out all other anonymous callers). Document prominently
  before an unauthenticated deploy; the fix is "configure `identify`", not a
  framework change.
- **Also noted — `LimitExceeded` returns HTTP 200:** `createAgentEndpoint`'s
  guard-rejection path (`sseSingle({_tag: "LimitExceeded", ...})`) always
  returns a 200 response carrying an SSE event, by design — this is
  EventSource-friendly (browsers' `EventSource` cannot read a non-2xx body),
  but a plain-`fetch` consumer that checks `res.ok`/`res.status` before
  parsing the body will silently treat a rate-limited/budget-exceeded/
  concurrency-blocked request as a normal success. Document this in
  consumer-facing docs for non-EventSource clients (plain fetch/curl/most
  non-browser HTTP clients) — they must inspect the first SSE event's `_tag`,
  not the HTTP status, to detect a guard rejection.
- **Severity:** blocker (pre-public-deploy gate) — acknowledged v1 scope, not a
  bug in the shipped code, but must not be forgotten before the endpoints are
  exposed beyond a trusted/internal caller.
