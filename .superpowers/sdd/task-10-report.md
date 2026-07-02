# Task 10 + 11 Report — Durable Interaction Rail + `.withUserInteraction()`

Folded Task 11 into Task 10 (the e2e test needs the builder method). One commit.

## Files changed (each mirrors an approval-rail piece)

### packages/core
- `src/streaming.ts` — added `InteractionResponse` interface + `InteractionResponseRef` FiberRef. **Mirrors** `ApprovalDecision` / `ApprovalDecisionRef`.
- `src/index.ts` — export `InteractionResponseRef` + `InteractionResponse` type. Mirrors the `ApprovalDecisionRef` export.

### packages/reasoning
- `src/kernel/state/kernel-state.ts` — added `interactionResponse?` to `KernelInput`. **Mirrors** `approvalDecision?`.
- `src/kernel/loop/runner.ts` — added the interaction resume re-entry block after the approval re-entry (`resolveApprovalReentry` site). **Mirrors** the approval re-entry, with the key semantic difference (see GAP-4): resets `status:"thinking"` + clears `output`/`terminatedBy` so the loop re-thinks, and synthesizes an assistant-call + `tool_result` message pair on `state.messages` (a bare observation step is invisible to the prompt assembler). Also imported `REQUEST_USER_INPUT_TOOL_NAME` + `KernelMessage`.
- `src/strategies/reactive.ts` — added `interactionResponse` to `ReactiveInput` + threaded into `kernelInput`. **Mirrors** `approvalDecision`.
- `src/services/reasoning-service.ts` — added `interactionResponse` to the execute-request type. **Mirrors** `approvalDecision`.

### packages/runtime
- `src/errors.ts` — added `InteractionStateError` tagged error + added to `RuntimeErrors` union. **Mirrors** `ApprovalStateError`.
- `src/engine/durable-resume.ts` — added `persistInteractionPauseAt`, `decideInteractionRecord`, `getPendingInteractionAt`. **Mirror** `persistApprovalPauseAt` / `decideApprovalRecord` / `getPendingApprovalAt`.
- `src/stream-types.ts` — added `pendingInteraction?` + `abstention?` to `StreamCompleted` (additive). Mirrors `pendingApproval?`.
- `src/engine/execute-stream.ts` — added `persistInteractionPause` local + `safeParseSchema` helper + the `awaitingInteractionFor` detection/emit block. **Mirrors** `persistApprovalPause` + the `awaitingApprovalFor` block.
- `src/engine/util.ts` — added `awaitingInteractionFor` to `ExecutionReasoningResult` metadata type + `normalizeReasoningResult`. **Mirrors** `awaitingApprovalFor`.
- `src/execution-engine.ts` — forward `awaitingInteractionFor` from `rr.metadata` to the TaskResult. **Mirrors** the `awaitingApprovalFor` forward.
- `src/engine/phases/agent-loop/reasoning-think.ts` — read `InteractionResponseRef` → forward as `interactionResponse`. **Mirrors** the `ApprovalDecisionRef` read.
- `src/builder/types.ts` — `AgentResult.status` union += `"awaiting-interaction"`, added `pendingInteraction?`. Mirrors `pendingApproval?`.
- `src/reactive-agent.ts` — imports + TaskResult type + result mapping (`status:"awaiting-interaction"` + `pendingInteraction`) + `runDurable` resume type (interaction variant) + FiberRef seeding + persist branch; new public `getDurableInfo()`, `listPendingInteractions()` (clone of `listPendingApprovals`), `respondToInteraction()` (clone of `decideAndResumeRun`).
- `src/builder.ts` — (Task 11) `private _userInteraction = false`, `withUserInteraction()` method, `build()` validation throwing `/durable/i` when `_userInteraction && !_durableRuns`. **Mirrors** the approval-detach validation.
- `src/builder/build-effect/runtime-construction.ts` — added `_userInteraction` to `BuilderRuntimeStateView` + threaded `userInteraction: true` into `kernelMetaTools` (incl. a fallback minimal payload when meta-tools are otherwise disabled).

### tests (new)
- `packages/runtime/tests/server/interaction-rail.test.ts` (Task 10 e2e).
- `packages/runtime/tests/server/with-user-interaction.test.ts` (Task 11).

### docs
- `wiki/Research/2026-07-agentic-ui-gap-log.md` — GAP-4 (resume re-think needs manual status/message reconstruction; approval "observe" path is latently broken) + GAP-5 (brief's `new ReactiveAgentBuilder("name")` doesn't compile).

## Test output
- `interaction-rail.test.ts` + `with-user-interaction.test.ts`: **written first, confirmed FAIL** (method missing), then implemented → **4/4 pass**.
- `bun test packages/runtime/tests/server`: **8 pass, 0 fail** (3 files).
- `bun test packages/runtime`: **1101 pass, 1 skip, 6 fail** classification:
  - 2 fail = `model routing — builder reasoning path (C1 gate, EventBus seam)` — the KNOWN pre-existing network tests (need real API/network).
  - 4 error = `Cannot find package 'reactive-agents'` (umbrella package) in capability-registry / debrief-integration / harness-profile / with-thinking tests — **confirmed pre-existing** (fail identically with my changes stashed). Import-resolution, independent of my logic.
  - **No new failures.**
- `bun test packages/reasoning`: **1868 pass, 4 todo, 0 fail**.

## tsc
- `packages/runtime` `tsc --noEmit`: **exit 0** (after adapting the test constructor call per GAP-5).
- `packages/reasoning` `tsc --noEmit`: **exit 0**.
- `packages/core` `tsc --noEmit`: **exit 0**.
- Rebuilt `core` + `reasoning` dist (`bunx turbo run build --filter=...`) before runtime tsc/tests — reasoning resolves from `dist` under Bun, so src edits were not live until rebuilt (GAP-3 / the brief's warning).

## Deviations
1. **Folded Task 11 into Task 10** (single commit) — the e2e needs `.withUserInteraction()`.
2. **Added `.withReasoning()` to the interaction e2e** — the `request_user_input` pause is intercepted in the reasoning kernel (`act.ts`); reasoning is default-off, and the approval e2e likewise uses `.withReasoning()`. Without it the run completes instead of pausing.
3. **Test constructor** — brief's `new ReactiveAgentBuilder("name")` doesn't compile (0-arg constructor); used `.withName(...)` (GAP-5).
4. **Resume re-entry is NOT a literal clone** of the approval observe block — it must reset terminal state + synthesize `tool_result` messages, else the injected value is silently dropped (GAP-4). The approval rail is a structural template, not a behavioral one for real pauses.

## Concerns
- GAP-4: the approval "observe"/real-pause resume path is latently broken the same way (masked by `injectPause` in its e2e). Flagged, not fixed (out of scope).
- `abstention` was added to `StreamCompleted` (additive, per brief) but is not yet populated by `execute-stream.ts` — the non-streaming path already surfaces abstention via `AgentResult.abstention`; the streaming field is available for Task 12 to wire.
