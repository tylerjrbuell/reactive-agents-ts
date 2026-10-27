---
type: implementation-plan
status: completed
created: 2026-10-25
authored-by: OpenCode
spec: "[[../Architecture/Design-Specs/2026-10-25-cortex-chat-engine-overhaul-spec|cortex chat engine overhaul + 0.17 sync spec]]"
tags: [chat, cortex, engine, streaming, tool-calling, sync-backlog, rag, mcp-oauth, implementation-plan]
---

# Cortex Chat Engine Overhaul + 0.17 Sync Implementation Plan

> **For agentic workers:** Tasks 1-3 route through the **runtime-warden** contract (dispatch a `general` subagent with MissionBrief, verify with typecheck + targeted tests, log to `wiki/Research/Pilots/2026-05-23-team-ownership-dev-contract/log.md`). Tasks 4+ run main-thread. TDD throughout. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Cortex chat runs the canonical per-session ChatEngine with agentic UX (live tool feedback, stop, recall), plus the Cortex Sync Backlog + 0.17 parities (coverage guard, skill strip, MCP OAuth, `withHarness`, RAG ingest, withers decision doc).

**Architecture:** One cached engine-backed session per chat session (`agent.session({persist:false, id, initialHistory})`); cortex DB stays source of truth; both SSE branches stream from it along the existing `AgentStreamEvent` grammar; stop aborts server-side via `request.signal`.

**Tech Stack:** Bun, Effect-TS (runtime), Elysia + `bun:sqlite` (cortex server), Svelte 5 runes stores (cortex UI), test provider + real SQLite (cortex tests).

**Spec:** `wiki/Architecture/Design-Specs/2026-10-25-cortex-chat-engine-overhaul-spec.md` (read alongside; plan argues from it).

## Global Constraints

- Verify user instructions took precedence: cancel semantics = full `request.signal` threading (user approved by go).
- No new `AgentStreamEvent` grammar members; no wire-format changes.
- No `any`, no `throw` in Effect paths, no `Co-Authored-By` trailers (commit-msg hook rejects).
- Framework additions limited to `initialHistory` + streamTurn recording fix. Everything else is cortex-side or composition.
- `useReasoning` is deleted, not deprecated (framework flag confirmed dead).
- Rebuild packages after every runtime change before running cortex tests: `bun run build:packages` (cortex imports `dist/`).
- Test commands: runtime `bun test packages/runtime/tests/<file> --timeout 15000`; cortex server `bun test apps/cortex/server/tests/<file> --timeout 15000`; UI `cd apps/cortex/ui && bun test src/lib --timeout 15000`.
- Never run the full monorepo suite mid-plan; full gates only in the final task.

## Review Focus

Failure modes the spec implies that task tests may not exercise:

1. Early SSE close with NO terminal event (client vanish mid-run): no engine recording, no DB assistant turn, no leak of the cached session. Test: Task 3 (engine) + Task 6 (cortex).
2. Abort arrives between `StreamCompleted` and generator `finally`: recording must have already happened; DB append must still run exactly once. Test: Task 6.
3. `initialHistory` combined with a wired `loadHistory`: loader must NEVER be called, history must be the seed. Test: Task 1.
4. Session config update mid-conversation: eviction disposes the agent; the NEXT turn rebuilds and resyncs history from the DB, so nothing said before the config change is lost. Test: Task 4.
5. Config with tools off but a stale `useReasoning: false` stored in the DB row (legacy persisted data): normalize must drop it without breaking decode. Test: Task 7.

---

## Phase 1, runtime (Tasks 1-3, runtime-warden)

### Task 1: `initialHistory` engine option

**Files:**
- Modify: `packages/runtime/src/chat/engine.ts` (`ChatEngineOptions` ~153-184, constructor ~293-300, `#resolveLoadedHistory` ~496+)
- Modify: `packages/runtime/src/chat.ts` (`SessionOptions` 124-143)
- Modify: `packages/runtime/src/reactive-agent.ts` (`session()` engine options block 2139-2143)
- Create: `packages/runtime/tests/chat-engine-initial-history.test.ts`

**Interfaces:**
- Produces: `ChatEngineOptions.initialHistory?: readonly ChatMessage[]`; `SessionOptions.initialHistory?: ChatMessage[]`; `agent.session({ initialHistory })`.

- [x] **Step 1: Failing tests.** In `chat-engine-initial-history.test.ts`: (a) constructor with `initialHistory: [user, assistant]` turns makes `engine.history()` return exactly that snapshot before any turn; (b) first `turn()` includes the seeded turns in the `messages` passed to the `complete` capability; (c) when `initialHistory` is non-empty AND `loadHistory` is wired, the loader is never called (spy count 0) and seeded history stands; (d) empty-array `initialHistory` does not latch (`loadHistory` still resolves on first turn).

- [x] **Step 2: Run to verify fail.** `bun test packages/runtime/tests/chat-engine-initial-history.test.ts --timeout 15000` (FAIL: unknown option / loader called).

- [x] **Step 3: Implement.** `ChatEngineOptions` gains the documented field: "Pre-seed the engine's session state; takes precedence over `loadHistory`, which is never called when a non-empty `initialHistory` is supplied." Constructor seeds `#history = [...initialHistory]` and sets `#loaded = true` when non-empty. `SessionOptions` and `session()` pass it through to the engine options object (line ~2139-2143) with a `cat:`-style JSDoc.

- [x] **Step 4: Pass + suite.** Step-2 command PASS, then `bun test packages/runtime/tests/chat --timeout 15000` green.

- [x] **Step 5: Commit** `feat(chat): initialHistory engine + session option for host-owned persistence`.

### Task 2: streamTurn records at terminal-event observation

**Files:**
- Modify: `packages/runtime/src/chat/engine.ts` (`streamTurn` tee loop 429-494)
- Test: `packages/runtime/tests/chat-engine-initial-history.test.ts` (new describes) or `packages/runtime/tests/chat-engine-stream-record.test.ts` (create)

**Context (the bug):** The tee generator yields events; the consumer (cortex SSE route) closes right after receiving `StreamCompleted`, which calls `teeTurn.return()` at the `yield` point, so the recording block AFTER `yield event` never runs (`engine.ts:464-484`). Recording must happen when the terminal event is OBSERVED, before yielding it.

- [x] **Step 1: Failing test.** Drive `runStreamTask` with a fake stream that emits `TextDelta`, then `StreamCompleted` (with `output`, `taskId`, `metadata.tokensUsed`). Iterate the wrapper with a consumer that `break`s immediately after receiving `StreamCompleted`. Assert `engine.history()` contains the user + assistant turn (today: empty). Also assert (b) a consumer that iterates fully records exactly once (terminal seen once, `recorded` guard), and (c) a consumer that breaks EARLY (before any terminal, after the first delta) records NOTHING and history stays empty.

- [x] **Step 2: Verify fail** (STEP-1 command; history empty is the red).

- [x] **Step 3: Implement.** Inside the loop: on observing `StreamCompleted`, run `#recordBothTurns` + `#publishTurns` + `#persistHistory` (all `await`ed) BEFORE `yield event`, guarded by a `let recorded = false` so a second iteration past the terminal cannot double-record. `StreamError`/aborted streams still record nothing (existing semantics preserved). JSDoc of `streamTurn` updated: recording happens at terminal-event observation, so a consumer closing on `StreamCompleted` cannot drop the turn.

- [x] **Step 4: Pass + full chat engine suite green** (`bun test packages/runtime/tests/chat --timeout 15000`).

- [x] **Step 5: Commit** `fix(chat): streamTurn records the turn when the terminal event is observed, not after tee-loop exit`.

### Task 3: Warden verification + engine regression sweep

- [x] **Step 1:** `bun run typecheck` clean.
- [x] **Step 2:** `bun test packages/runtime --timeout 15000` green (whole runtime package).
- [x] **Step 3:** `bun run build:packages` clean (cortex consumes dist).
- [x] **Step 4:** Warden UpwardReport; parent verifies + appends pilot-log YAML entry (`warden: runtime-warden`, tasks 1-3).

**Commit boundary:** Phase 1 lands as its own commit(s) on `dev`; Phase 2 starts after.

---

## Phase 2, cortex server (Tasks 4-7, main thread)

### Task 4: engine-backed `buildSession` (cached, always streaming)

**Files:**
- Modify: `apps/cortex/server/services/chat-session-service.ts` (`buildSession` 311-327; `chatStream` branch param build 254; deadline `streaming` flag)
- Test: `apps/cortex/server/tests/chat-session-service.test.ts` (extend)

**Interfaces:**
- Consumes: Task 1 `agent.session({ persist: false, id, initialHistory })`.
- Produces: `CachedChatSession { session: AgentSession; agent }` where `session` is engine-backed (runStream-capable). `buildChatAgentParams(sessionId, agentConfig, stableAgentId)` — the `{streaming}` option object is REMOVED; streaming is always true.

- [x] **Step 1: Failing tests.** (a) `buildSession` returns a session whose `runStream(message)` returns a RunHandle (does not throw the legacy "requires engine-backed session" capability error); (b) rebuild-after-eviction resync: create session, append turns via `svc.chat`, force a second `buildSession` (evict), seed-history equality with DB turns via the captured provider prompt; (c) config `updateSessionConfig` disposes the evicted agent (dispose spy).

- [x] **Step 2: Verify fail** (run command: `bun test apps/cortex/server/tests/chat-session-service.test.ts --timeout 15000`).

- [x] **Step 3: Implement `buildSession`.**
```ts
const params = this.buildChatAgentParams(sessionId, agentConfig, stableAgentId);
const agent = await buildCortexAgent(params);
const initialHistory = turnsToChatMessages(getChatTurns(this.db, sessionId));
const session = agent.session({
  persist: false,
  id: sessionId,
  ...(initialHistory.length > 0 ? { initialHistory } : {}),
});
```
Delete the legacy `new AgentSession(chatFn, ...)` construction. Notes: `agent.session()` wires `runTask`/`runStreamTask`/`complete`/`publishTurn`/`saveHistory(undefined when persist:false)`/`systemPrompt`/`contextSummary`; persona/context parity flows through `buildChatAgentParams` unchanged.

- [x] **Step 4: Pass + full service test file green.**
- [x] **Step 5: Commit** `feat(cortex): chat sessions run the canonical engine via agent.session()`.

### Task 5: chatStream unification + empty-turn fix

**Files:**
- Modify: `apps/cortex/server/services/chat-session-service.ts` (`chatStream` 184-309)
- Test: `apps/cortex/server/tests/chat-session-service.test.ts`

**Interfaces:**
- Consumes: Task 4 `CachedChatSession.session.runStream(message, { density?, signal? })`.
- Produces: `chatStream(sessionId: string, message: string, signal?: AbortSignal): AsyncGenerator<AgentStreamEvent>` (third param added here; route wired in Task 6 remains compatible by arity).

- [x] **Step 1: Failing tests.** (a) Tools-on stream: cached session used (no per-turn `buildCortexAgent` for the stream branch — assert build count == 1 across two streamed turns with the same config), events yielded include `ToolCallStarted`/`ToolCallCompleted` (test provider emits them at density full), DB recording still the service's job exactly once; (b) no-tools/no-steps direct branch unchanged shape (`TextDelta` + `StreamCompleted` with `metadata`/`toolSummary`); (c) direct-branch error path yields `StreamError` and the `finally` does NOT append an empty assistant turn (empty `replyText` guard, `chat-session-service.ts:239-247`).

- [x] **Step 2: Verify fail.**
- [x] **Step 3: Implement.** Tools/steps branch: resolve cached entry (build+cache on miss), append user turn, iterate `entry.session.runStream(message, { density: "full" })` re-yielding events, track `tokensUsed/toolsUsed/steps/replyText` from `StreamCompleted` exactly as today, service `finally` owns the DB append + `updateSessionLastUsed`; the per-turn `agent.dispose()` call is DELETED (cached agent lives until eviction; Task 4 covers dispose on evict). Direct branch keeps `session.chat()` + synthesized events, with the empty-assistant guard from (c).
- [x] **Step 4: Pass.**
- [x] **Step 5: Commit** `feat(cortex): chat SSE streams through the cached engine session (kill ephemeral per-turn agent)`.

### Task 6: cancel threading (request.signal)

**Files:**
- Modify: `apps/cortex/server/api/chat.ts` (stream route 288-335)
- Modify: `apps/cortex/server/services/chat-session-service.ts` (chatStream signature from Task 5)
- Test: `apps/cortex/server/tests/chat-session-service.test.ts`

**Interfaces:**
- Consumes: `connectRunStream`'s existing `signal?: AbortSignal` (`packages/ui-core/src/stream/connect.ts:27`), `agent.runStream(input, { signal })` (already forwarded by `session()`'s `runStreamTask`, verified `packages/runtime/src/reactive-agent.ts:2075-2084`).
- Produces: client stop = server abort. `StreamCancelled` yields (not `StreamError`) when the signal fires.

- [x] **Step 1: Failing test.** Start `svc.chatStream(sessionId, message, controller.signal)` against a test-provider agent whose stream is slow; abort after the first event; assert (a) iteration ends promptly, (b) an `AbortError`-shaped failure maps to a yielded `{ _tag: "StreamError", cause: "cancelled" }` (or the engine's cancelled semantics) rather than a thrown error, (c) no assistant turn appended for the aborted run.
- [x] **Step 2: Verify fail** (today: no signal param consumed in the loop).
- [x] **Step 3: Implement.** Route handler reads `request.signal` (Elysia exposes `request`); pass to `svc.chatStream(..., request.signal)`; thread as `engine.streamTurn`'s `TurnOptions.signal` via `session.runStream(message, { density, signal })`. In the service, wrap the iterate loop so `signal.aborted` maps to a `StreamCancelled` yield (AI-honest: cancellation is terminal, not error); also pass the signal to the direct branch's fetch-side (no-op for buffered chat, but signature symmetric).
- [x] **Step 4: Pass.**
- [x] **Step 5: Commit** `feat(cortex): chat SSE cancellation aborts the agent run server-side`.

### Task 7: config parity forward + useReasoning deletion (server)

**Files:**
- Modify: `apps/cortex/server/services/chat-session-service.ts` (`buildChatAgentParams` 333-563; `VALID_REASONING_STRATEGIES` 29-35)
- Modify: `apps/cortex/server/api/chat.ts` (`ChatSessionConfigBody` 5-100 + both mapping sites)
- Modify: `apps/cortex/server/services/cortex-agent-config.ts` (normalize: drop `useReasoning`; coerce `outputSchema` string→object)
- Test: `apps/cortex/server/tests/chat-session-service.test.ts` + `apps/cortex/server/tests/config-parity.test.ts` (assert-sweep)

**Interfaces:**
- Consumes: `BuildCortexAgentParams` fields ALREADY implemented by `build-cortex-agent.ts`: `auditRationale`, `skills` (with `activate`), `budget`, `grounding`, `fabricationGuard`, `modelRouting`, `outputSchema` (lines 93-166). Only the CHAT param bridge (Task's file) drops them today.
- Produces: chat sessions can set every run-wired feature key listed above; `useReasoning` gone from chat + runs API bodies AND `LaunchParams` AND `gateway-process-manager` forwarding AND `cortex-to-agent-config.ts` mapping AND old DB rows decoded harmlessly (normalize creates no `out.useReasoning` key; decode of the stored raw is unaffected).

- [x] **Step 1: Failing tests.** One per forwarded key: build a chat agent with e.g. `budget: { tokenLimit: 100 }`, `grounding: { mode: "warn" }`, `fabricationGuard: "warn"`, `modelRouting: { enabled: true }`, `outputSchema: '{"type":"object","properties":{"answer":{"type":"string"}}}'` (string input), `auditRationale: true`, `skills: { paths: [...], activate: [...] }`; assert the corresponding builder call happened (marker via `getCapabilityManifest` or spy convention used in existing parity tests). Plus: strategy whitelist accepts `blueprint`/`code-action`/`direct`; `fallbacks.errorThreshold` dropped from schema + normalize; metaTools `enabled:false` disables (explicit), absent `metaTools` stays default-on (existing convention, now documented).
- [x] **Step 2: Verify fail.**
- [x] **Step 3: Implement.** Forward keys in `buildChatAgentParams` (read raw agentConfig like other keys, respecting enableTools gating where the run path gates them). `patch /config` + POST `/sessions` map the new optional fields through. Delete `useReasoning`: `chat.ts` body+maps, `api/runs.ts` body+map, `runner-service.ts:86,296`, `gateway-process-manager.ts:285,342`, `cortex-to-agent-config.ts:80-82`, `cortex-agent-config.ts:239-241`, `BuildCortexAgentParams.useReasoning` (132) — one delete-condition per file, all with grep verification: `grep -rn "useReasoning" apps/cortex/server --include='*.ts'` returns only test morgue or nothing.
- [x] **Step 4: Pass (`chat-session-service` + `chat-runs-config-drift` + `config-parity` green).**
- [x] **Step 5: Commit** `feat(cortex): chat config parity for runtime features; delete dead useReasoning toggle`.

---

## Phase 3, cortex UI (Tasks 8-10, main thread)

### Task 8: store reductions (tool chips, cancelled, stop)

**Files:**
- Modify: `apps/cortex/ui/src/lib/stores/chat-store.ts` (`ChatTurn` 27-58, `sendMessageStream` 279-530)
- Test: `apps/cortex/ui/src/lib/stores/chat-store.test.ts` (extend; fake-fetch SSE pattern preserved)

**Interfaces:**
- Consumes: `UiStreamEvent` tags `ToolCallStarted` (`callId`, `name`), `ToolCallCompleted` (`callId`, result/error), `StreamCancelled` (verify exact field names from `packages/runtime/src/stream-types.ts:84-97,109-130` at implementation); ui-core `connectRunStream` `signal?: AbortSignal`.
- Produces: `ChatTurn { toolCalls?: Array<{ id: string; name: string; status: "running" | "done" | "failed" }>; cancelled?: boolean }`; store method `stop()` (aborts the module-level controller for the active stream); `sendMessageStream(message, signal?: AbortSignal)`.

- [x] **Step 1: Failing store tests.** (a) `ToolCallStarted` appends `{ id, name, status: "running" }` to the streaming turn; (b) `ToolCallCompleted` with same `callId` flips status to `done`; a failure result flips to `failed`; (c) `StreamCancelled` sets `cancelled: true`, `sending: false`, no error thrown, streaming flag cleared, partial content kept; (d) `stop()` aborts: second event after `stop()` never arrives (fake stream respects signal) and turn shows `cancelled`; (e) permission-gated `ToolCallStarted` with `pendingApproval` (if the tag carries one) sets an `awaitingApproval` turn flag (check the tag's real shape first; if approval never arrives as an event in stream-types, DROP this sub-test and note it).
- [x] **Step 2: Verify fail.**
- [x] **Step 3: Implement.** Add `_tag` cases + `let activeController: AbortController | null` module state; thread `controller.signal` into `connectRunStream`; `stop()` aborts + nulls. Thought filtering by toggle: `streamReasoningSteps: false` (read from the active session's `agentConfig`) uses `density` only for tool visibility; the filter is an ADMIN-side concern — capture as a UI render-time filter (Task 9), NOT a store drop (store keeps reasoningSteps for inspection). Live token/cost feed: check `stream-types.ts` for a mid-stream metadata source (e.g. `IterationProgress.metadata` carrying tokens); when one exists, map it into `turn.liveTokens`/`liveCost` reductions; when none exists, REMOVE the mid-stream animated token chip render branch (`ChatPanel.svelte:154-160`) so the UI never shows a permanently-empty live feed (honest UI: totals appear at completion).
- [x] **Step 4: Pass + existing 8 SSE tests still green.**
- [x] **Step 5: Commit** `feat(cortex-ui): live tool-call chips, cancel + stop reductions in chat store`.

### Task 9: ChatPanel render (chips, stop button, stopped badge, retry)

**Files:**
- Modify: `apps/cortex/ui/src/lib/components/ChatPanel.svelte`
- Modify: `apps/cortex/ui/src/lib/stores/chat-store.ts` (add `retry(message)` re-export if needed, else reuse `sendMessageStream(lastUserText)`)
- Test: component-level check via existing UI test setup if present; otherwise keep store-tested logic thin in the component (render-only).

- [x] **Step 1:** Live chips block per assistant turn: reuse the `toolsUsed` chip row pattern (`ChatPanel.svelte:168-178`) but bind `turn.toolCalls` first (live states: pulse dot for `running`, plain for `done`, error-red text for `failed`); `turn.toolsUsed` remains the post-hoc fallback for turns loaded from DB history.
- [x] **Step 2:** Stop button: when `sending`, the send button (326-336) becomes a stop button (`stop_circle` icon) calling `chatStore.stop()`; input stays enabled for the next message.
- [x] **Step 3:** Cancelled badge: when `turn.cancelled`, render `stopped` editorial chip instead of error styling; content retained.
- [x] **Step 4:** Retry affordance: failed turn (error state) shows a small `re-ask` button that resends the last user message body (`chatStore.sendMessageStream(lastUserText)`).
- [x] **Step 5:** Thought filtering: render `turn.reasoningSteps` only when the active session's `streamReasoningSteps` config is true (or always when the toggle is on); tool chips always show. Default: hidden.
- [x] **Step 6:** Build + test: `cd apps/cortex/ui && bun run build`; `bun test src/lib --timeout 15000`.
- [x] **Step 7: Commit** `feat(cortex-ui): ChatPanel agentic UX (live tool chips, stop, stopped badge, retry)`.

### Task 10: RunChatTab dedupe onto the shared reduce loop

**Files:**
- Modify: `apps/cortex/ui/src/lib/components/RunChatTab.svelte` (184-352 duplicate SSE loop)
- Test: existing `RunChatTab` behavior unchanged (manual verification via run view; store-level pieces already covered in Task 8).

- [x] **Step 1:** Extract the streaming consume loop into a shared helper (e.g. `consumeChatStream(endpoint, body, perEvent, { error, completed }, signal)`) in `chat-store.ts`; both `sendMessageStream` and `RunChatTab` consume it. Event cases duplicated between the two files collapse to ONE implementation carrying the Task 8 reductions.
- [x] **Step 2:** `RunChatTab` keeps only its run-context specifics (endpoint, RunState preview plumbing), delegates event handling to the helper.
- [x] **Step 3:** `bun run build:ui` clean; UI tests green.
- [x] **Step 4: Commit** `refactor(cortex-ui): single shared chat SSE loop for ChatPanel + RunChatTab`.

---

## Phase 4, sync batch (Tasks 11-15, main thread)

### Task 11: `useReasoning` UI removal

**Files:**
- Modify: `apps/cortex/ui/src/lib/components/AgentConfigPanel.svelte` (`useReasoning` toggle)
- Modify: `apps/cortex/ui/src/lib/types/agent-config.ts` (drop the field)
- Test: `grep` sweep `grep -rn "useReasoning" apps/cortex` returns nothing outside test morgue/history comments.

- [x] **Step 1:** Remove the control + type + payload mapping (`cortex-runs-post-body.ts` if present) + any `ChatSessionConfigInput.useReasoning` in `chat-store.ts:78-117`.
- [x] **Step 2:** `cd apps/cortex/ui && bun run build` clean.
- [x] **Step 3: Commit** `chore(cortex-ui): remove dead useReasoning reasoning-kernel toggle (framework flag deleted)`.

### Task 12: config-parity coverage guard

**Files:**
- Modify: `apps/cortex/server/tests/config-parity.test.ts`
- Reference: `packages/runtime/src/builder.ts` (all `with[A-Z]` methods)

- [x] **Step 1: Failing test.** New describe in `config-parity.test.ts`: parse `packages/runtime/src/builder.ts` source at test time (read the file, collect `^\s{4}with[A-Z][A-Za-z]+\(` method names); for each name, assert membership in exactly one of the three sets compiled into the test: `WIRED` (referenced in `build-cortex-agent.ts` or `cortex-to-agent-config.ts`), `OVERLAY_REACHABLE` (settable via `rawConfig`/AgentConfig fields, thinner list), `NOT_APPLICABLE` (explicit allow-list with a one-line reason). Initially the NOT_APPLICABLE list mirrors the Phase 6 decision doc (withCircuitBreaker, withRateLimiting, withA2A, withChannels, withReceiptSigning, withAudit, withContract, withCalibration, withBehavioralContracts, withSelfImprovement) so the gate is green at merge.
- [x] **Step 2: Verify fail** (run; the unclassified withers currently missing from all sets are the red list).
- [x] **Step 3: Fill sets.** Walk the diff: each newly-identified wither gets wired (if trivially wired, e.g. `withBudget` was actually missing from the RUNS parity tests, add the assertion) OR an explicit allow-list with a comment. Fail the test on any wither in no set.
- [x] **Step 4: Pass.**
- [x] **Step 5: Commit** `test(cortex): config-parity coverage guard over every builder wither`.
- [x] **Step 6:** Same coverage guarantee for chat keys: extend `chat-runs-config-drift.test.ts` to assert every Phase 7-forwarded chat key is in `ChatSessionConfigBody` (the drop-prevention this task never had for chat).

### Task 13: skill-lifecycle strip in run view

**Files:**
- Create: `apps/cortex/ui/src/lib/components/SkillStrip.svelte` (new)
- Modify: `apps/cortex/ui/src/lib/components/RunDetail.svelte`
- Reference: `VitalsStrip.svelte` (strip pattern); `RawEventLog.svelte` skill color mapping (2026-08-21 sync commit).

- [x] **Step 1:** Component props `{ events: Array<{ tag: string; skill: string; ts: number }> }` derived from the run's events (`SkillActivated`, `SkillPromoted`, `SkillRefined`, `SkillRolledBack`, `SkillConflictDetected`, `SkillExpired` if present in the union); badge strip with the shared color mapping; render into `RunDetail` beside `VitalsStrip`.
- [x] **Step 2:** `bun run build:ui` clean; smoke via a fixture run with skill events (Lab-routed), verification note in the commit body.
- [x] **Step 3: Commit** `feat(cortex-ui): skill-lifecycle badge strip in run view`.

### Task 14: MCP OAuth 2.1 auth exposure (0.17)

**Files:**
- Modify: `apps/cortex/server/db/mcp-queries.ts` (`parseMcpConfig` + stored server shape gets an `auth` field)
- Modify: `apps/cortex/server/api/mcp.ts` (whatever route name exists; find via `grep -rn "mcp" apps/cortex/server/api --include='*.ts' -l`) body schema
- Modify: `apps/cortex/ui/src/lib/components/` MCP form (find via `grep -rln "mcp" apps/cortex/ui/src/lib/components --include='*.svelte'`)
- Test: `apps/cortex/server/tests/api-mcp-servers.test.ts` (extend)

**Interfaces:**
- Consumes: framework `.withMCP({ auth })` (0.17): `{ type: "client_credentials" | "private_key_jwt" | "authorization_code", clientId, clientSecret?, ... }`; `stdio` transport with `auth` set = framework error (fail-fast in the cortex form too, not a runtime crash). Token store stays framework-owned (`$HOME/.reactive-agents/mcp-auth`, 0700/0600).

- [x] **Step 1: Failing test.** POST/PUT a remote MCP server config with `transport: "streamable-http"`, `endpoint`, `auth: { type: "client_credentials", clientId, clientSecret }`; assert the persisted+parsed config round-trips `auth` AND the resolved `buildCortexAgent` params carry it into `mcpConfigs`. Negative: `stdio` + `auth` rejected at the form/API boundary with a validation error.
- [x] **Step 2: Verify fail**, **Step 3: Implement** (auth field persisted alongside the existing fields; type-union validation in BOTH the Elysia body and the UI form; interactive flow NOT implemented, render a bullet note `rax mcp login` in the form help text), **Step 4: Pass**, **Step 5: Commit** `feat(cortex): MCP OAuth 2.1 client auth config (0.17 sync)`.

### Task 15: `withHarness()` advanced panel section

**Files:**
- Modify: `apps/cortex/server/services/cortex-to-agent-config.ts` (or `build-cortex-agent.ts` overlay, per where the rawConfig path lives)
- Modify: `apps/cortex/ui/src/lib/components/AdvancedFrameworkConfig.svelte`
- Modify: `apps/cortex/server/api/runs.ts` + `api/chat.ts` body schemas (one optional `harness?: Partial<HarnessConfig>` field, forwarded under runs AND chat parity)
- Test: extend `config-parity.test.ts` + `chat-runs-config-drift.test.ts`

**Interfaces:**
- Consumes: `.withHarness(harnessConfig)` (0.16, `packages/runtime/src/builder.ts`), fields per its HarnessConfig type (read exact field list from the builder's type at implementation, do not guess).

- [x] **Step 1: Failing tests** (wired field assertion in both parity gates). **Step 2: Verify fail.**
- [x] **Step 3: Implement.** UI section exposes the framework-honored fields (tool disclosure / tool discovery / tool index / verbose rules / context budgets), forward in builder overlay: `if (params.harness) b = b.withHarness(params.harness as HarnessConfig)`. Honest UI: fields the harness accepts but cortex does not chart get a muted `not wired in cortex` note label rather than fake toggles.
- [x] **Step 4: Pass both parity gates. **Step 5: Commit** `feat(cortex): harness typed control surface (withHarness) in advanced config`.

---

## Phase 5, RAG (Tasks 16-17, main thread)

### Task 16: documents ingestion server

**Files:**
- Modify: `apps/cortex/server/services/ingest-service.ts` OR new `server/services/document-service.ts` (choose where existing `withDocuments`-adjacent glue would sit; empty today)
- Modify: `apps/cortex/server/api/runs.ts` + runner service `LaunchParams`
- Modify: `apps/cortex/server/services/cortex-agent-config.ts` (normalize a `documents` key: array of `DocumentSpec`-shaped records)
- Modify: `apps/cortex/server/services/build-cortex-agent.ts` (overlay: `if (params.documents?.length) b = b.withDocuments(params.documents)`)
- Test: `apps/cortex/server/tests/config-parity.test.ts` extend + new `server/tests/document-ingest.test.ts`

**Interfaces:**
- Consumes: `.withDocuments(docs: DocumentSpec[])`, `DocumentSpec` from `packages/runtime/src/context-ingestion.ts:30` — `{ source: string; content?: string; format?: string; chunkStrategy?: string; maxChunkSize?: number }`.
- Produces: `LaunchParams.documents?: Array<DocumentSpec>`; POST `/api/runs` body accepts `documents`; chat sessions accept and forward it (same chat parity route as Task 7).

- [x] **Step 1: Failing tests.** (a) POST body with one `DocumentSpec` (path-based: `source` only, no `content`) reaches the builder overlay with the spec intact (spy/marker per existing parity test convention); (b) normalize round-trips the array, drops unknown keys; (c) ingest route SAD path: missing both `source` and `content` → 400 validation error.
- [x] **Step 2: Verify fail. **Step 3: Implement.** Ingest route: POST `/api/runs/:runId`-compatible? NO — scope is per-launch: `documents` rides the launch POST body and the chat session config; no new persist model this task (UI stores the array in the session config payload). Content upload via base64 field OR file path is a UI concern (Task 17).
- [x] **Step 4: Pass. **Step 5: Commit** `feat(cortex): withDocuments ingestion wiring (RAG/MCP sync item 2c)`.

### Task 17: documents Lab UI (minimal)

**Files:**
- Modify: `apps/cortex/ui/src/lib/components/AgentConfigPanel.svelte` (Documents section: path input OR content paste, list with remove buttons)
- Modify: `apps/cortex/ui/src/lib/cortex-runs-post-body.ts` (launch body mapping)
- Test: store-level thin; verified by build + parity guard from Task 16.

- [x] **Step 1:** Add Documents block (compact list, `+ Add document` with `source` text input + optional `content` textarea; remove per row). Store in the config object under `documents` matching Task 16's shape.
- [x] **Step 2:** `bun run build:ui` clean; `bun test` green.
- [x] **Step 3: Commit** `feat(cortex-ui): minimal documents (RAG) configuration block in Lab`.

---

## Phase 6, decisions + gates (Tasks 18-20)

### Task 18: production-withers decision doc

**Files:**
- Create: `wiki/Decisions/2026-10-25-cortex-production-withers-exclusion.md` (frontmatter type: decision, status: accepted)
- Modify: `wiki/Decisions/Decision Index.md` (append row)

- [x] **Step 1:** Write the doc: names the 10 excluded withers (withCircuitBreaker, withRateLimiting, withA2A, withChannels, withReceiptSigning, withAudit, withContract, withCalibration, withBehavioralContracts, withSelfImprovement) with one-line reasons each; records bandit strategy selector + RAG doc management as deferred future work; instructs future drift audits to reference this doc instead of re-flagging (`config-parity` coverage guard is the enforcement point).
- [x] **Step 2: Commit** `docs(cortex): production-hardening withers exclusion decision (bandit deferred)`.

### Task 19: changeset + docs truth

**Files:**
- Create: `.changeset/cortex-chat-engine-overhaul.md` (runtime: minor for `initialHistory` + streamTurn recording fix; cortex: minor for the chat overhaul)
- Modify: `apps/cortex/AGENTS.md` (chat surface summary: engine-backed sessions, coverage guard pointer, decision doc link)
- Modify: root `AGENTS.md` framework snapshot only if the count of consumer chat surfaces changes (it does not)

- [x] **Step 1:** Changeset format per repo convention (one changelog paragraph per package with the new `initialHistory` option documented).
- [x] **Step 2:** `wiki/Planning/Planning-Index.md` row status update + this plan's checkboxes already maintained during execution.
- [x] **Step 3: Commit** `docs: cortex chat overhaul changeset + agent-guide truth`.

### Task 20: full gates

- [x] **Step 1:** `bun run build:packages` clean.
- [x] **Step 2:** `bun run typecheck` clean.
- [x] **Step 3:** `bun test apps/cortex/server/tests --timeout 15000` + `cd apps/cortex/ui && bun test src/lib --timeout 15000` green.
- [x] **Step 4:** `bun test packages/runtime/tests/chat --timeout 15000` green.
- [x] **Step 5:** `bun run changeset version` NOT run (tag-driven); only the changeset file lands.
- [x] **Step 6:** Review pattern check on changed files (`/review-patterns` summary in the final commit message body per repo contract).
- [x] **Step 7:** Final commit `chore: gates green for cortex chat engine overhaul batch 1` (or merge-to-dev flow per `finishing-a-development-branch` skill if a worktree branch is in play).

---

## Execution Log

| Task | Status | Commit | Notes |
|---|---|---|---|
| 1 | pending | - | warden-dispatched |
| 2 | pending | - | warden-dispatched |
| 3 | pending | - | warden verification gate |
| 4-20 | pending | - | main thread |

## Execution notes (2026-10-27 adversarial review)

- Task 10 (shared SSE loop) was NOT actually done at 2026-10-25 close — `RunChatTab` kept a ~170-line duplicate loop that never set `liveText`. Landed 2026-10-27 as `ui/src/lib/stores/chat-stream.ts` (`streamAssistantTurn`), consumed by both `chat-store` and `RunChatTab`.
- Task 17 shipped as a JSON textarea, not the per-row list/remove UI the task text describes; deliberate minimal deviation, upgrade is open.
- Task 16 step 1(c) (400 on missing source+content) is realised as: `source` optional in the body schema, server labels content-only docs `inline`, entries with neither are dropped (`parseDocumentSpecs`, `server/tests/document-ingest.test.ts`).
- Review fixes beyond the plan: single-flight + LRU cap on cached agents, busy guard, turn pairs persisted only on success, `skills.activate` schema passthrough, shutdown dispose, UI reducer gated on `outputSchema`.
