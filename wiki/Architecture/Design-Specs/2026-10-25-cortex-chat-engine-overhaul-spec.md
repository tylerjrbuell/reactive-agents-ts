---
type: design-spec
status: implemented
created: 2026-10-25
authored-by: OpenCode
related: "[[Architecture/Design-Specs/2026-10-23-canonical-chat-engine-design|canonical chat engine design]]"
tags: [chat, cortex, engine, streaming, tool-calling, sync-backlog, rag, mcp-oauth, design-spec]
---

# Cortex Chat Engine Overhaul + 0.17 Sync

**Status:** draft (awaiting user spec-review gate).
**Scope:** `apps/cortex/**` (chat server, chat UI, config cascade, sync backlog items) + one warden-routed runtime change in `packages/runtime/src/**`.
**Supersedes:** the "Phase 2 = Jem" arc of the canonical-chat-engine initiative. Jem is deferred; this initiative modernizes cortex chat first. Design source: `apps/jem/FINDINGS.md`-style gap audit is NOT the origin here; the origin is a 3-explorer cortex audit (2026-10-25) + `Cortex Sync Backlog` (2026-08-21, framework 0.15-0.16 era) + 0.17.0 feature delta review.

---

## 0. Problem statement

Cortex chat does not run the canonical ChatEngine. Post merge (`dca7e251b`), three chat surfaces still bypass it:

1. `chat()` (non-stream) and the no-tools SSE branch: legacy `chatFn` + `AgentSession` constructed by hand in `buildSession` (`chat-session-service.ts:313-326`), delegating to `agent.chat(msg, opts, hist, sessionId)` → `_chatLegacy` transient engine per call.
2. Tools SSE branch: an ephemeral per-turn streaming agent via `agent.runStream()`: no session, no shared history, double writes into the same memory key alongside the cached non-streaming agent.
3. The no-tools SSE branch keeps the cheap direct path today, which is fine, but it is also the only branch that uses the cached session.

Consequences surfaced by the audit:

- Live tool activity never reaches the UI: the store handles 5 event tags total; `ToolCallStarted`/`ToolCallCompleted`/`StreamCancelled`/`TrustEvent`/approval-pending are all dropped.
- No stop button (no AbortSignal anywhere in chat). A detached SSE stream keeps the agent burning tokens after client disconnect.
- Empty assistant turn persists in the transcript on mid-stream `StreamError`.
- Dead-end config keys matter for chat parity: `useReasoning` (now confirmed framework-dead: zero hits in `packages/runtime/src` after the v0.16 legacy-arm deletion), `auditRationale`, `skills.activate` (chat neglects a now-wired key), `budget`, `grounding`, `fabricationGuard`, `modelRouting`, plus `outputSchema` stored as a string (type-broken). Stale whitelists/allow-lists: strategy whitelist missing `blueprint`/`code-action`/`direct`, metaTools silent-default-on inversion, `task-complete` in `CORTEX_FRAMEWORK_ALLOWED_TOOLS`, guardrail "thresholds" that are fiction (framework has booleans), `memory.working` checkbox cosmetic, `fallbacks.errorThreshold` post-v0.14 dead.
- On top: the Cortex Sync Backlog + 0.17 delta list feature gaps that this initiative must absorb (phases 4-6 below).

Goal, in one line: make cortex chat run the same unified engine as everything else, with Claude/ChatGPT-like agentic UX (live tool feedback, recall, cancel, robust errors) and pull cortex up to framework 0.17.0.

---

## 1. Design decisions (ratified in brainstorming)

| Decision | Ruling |
|---|---|
| Approach | **A: server-first unified engine + UI lift along the existing `AgentStreamEvent` grammar.** Rejected: GatewayChatManager route (bot-shaped transport fights cortex), minimal swap (fails the agentic-UX bar) |
| Framework change | Exactly one: `initialHistory?: ChatMessage[]` on engine options + `SessionOptions`. The engine seeds once at construction. Warden-routed, ~15 LOC + tests |
| Persistence | Cortex DB (`cortex_chat_turns`) stays source of truth. Engine holds in-memory state seeded from DB; `persist: false` (framework `SessionStoreService` persist targets the wrong store for cortex). Service keeps appending user/assistant turns exactly as today |
| Agent lifecycle | Cached chat agent is always built `.withStreaming()`. One agent per session. Ephemeral per-turn streaming agents are deleted. Cached agent disposed on eviction/config-update/delete |
| No-tools + no-steps SSE | Keeps engine-direct `session.chat()` path (no kernel run). Forcing a kernel run here spends latency for zero gain |
| Stream density | Tool chats stream `density: "full"` by default (tool events only ride at full density). UI filters thoughts by the `streamReasoningSteps` toggle: tool activity visible, thinking hidden by default |
| Cancel semantics | Client stop aborts the agent run server-side: `request.signal` threaded `chatStream` → engine `streamTurn` → `agent.runStream` (ui-core `connectRunStream` already supports `signal?`). Not just an SSE pipe close. Flagged for review; assistant recommendation |
| UI events | No new wire event format. UI consumes the grammar it already speaks but never rendered |
| RAG (`withDocuments`) | **Minimal ingestion** (user ruling): path/file-list based document ingest route + Lab wiring + builder wiring. No full document-management UI |
| Production-hardening withers | **Doc-only exclusion** (user ruling): decision doc names `withCircuitBreaker`, `withRateLimiting`, `withA2A`, `withChannels`, `withReceiptSigning`, `withAudit`, `withContract`, `withCalibration`, `withBehavioralContracts`, `withSelfImprovement` explicitly out-of-scope for the dev desk; bandit strategy selector listed as deferred in the same doc |
| `withHarness()` | **Included** (user ruling): @0.16 typed control surface for harness internals gets an Advanced panel section. This is the biggest "hands-on desk" parity item |

---

## 2. Explorer-derived ground truth (2026-10-25 audit)

Key verified facts that constrain the design (full detail in session logs, digest here):

- `engine.ts:464-484`: `streamTurn` records the turns ONLY after the tee loop fully exits. Cortex's SSE route hard-closes right after `StreamCompleted` so an early consumer close (already pinned by cortex test 16) drops the engine turn recording. Fix: engine records at terminal-event observation, not post-loop exit. Small, mechanics-in-engine.
- `agent.session()` has no initialHistory today; `persist: true` targets framework `SessionStoreService`, not the cortex DB.
- `api/chat.ts` SSE 404 branch is dead code (unknown session yields HTTP 200 + synthesized StreamError).
- `RunChatTab.svelte:184-352` duplicates the entire store SSE loop; both mutate shared state. Dedupe the reducer.
- Live token chips are rendered but never fed.
- Tool events ride only at `density: "full"`.
- `config-parity.test.ts` is a regression guard only (hand-listing wired fields); nothing asserts builder-coverage.

---

## 3. Phase plan

Each phase independently mergeable to `dev`. Phases 2-4 are main-thread work; Phase 1 is warden-routed (`packages/runtime/**` via `general` subagent with MissionBrief in / UpwardReport out).

### Phase 1: runtime (warden)

1. `initialHistory?: ChatMessage[]` on `ChatEngineOptions` and `SessionOptions`; engine seeds once at construction, marks the load-latch done when no `loadHistory` is wired. Type pins + engine tests.
2. Engine records the assistant turn when the terminal stream event is observed inside the tee loop (helper-local state), not after loop exit. Pins: recording survives early consumer close; recording happens exactly once per streamed turn.
3. No changes to `run()`/`runStream()`; no other engine surface edits.
4. Wire warden-log YAML entry per the standing convention.

### Phase 2: chat server (`chat-session-service.ts` + `api/chat.ts` + `build-cortex-agent.ts`)

1. `buildSession` → engine-backed: `agent.session({ persist: false, id: cortexSessionId, initialHistory })` (agent built `.withStreaming()`); legacy `chatFn`/`new AgentSession(...)` construction deleted from cortex.
2. `chat()` + both SSE branches share one cached session. `chatStream` uses `session.runStream(message, { density: "full" })` when tools or reasoning-steps are on; direct `session.chat()` when both off.
3. Cancel: route handler threads `request.signal` (or an explicit close handler) into `svc.chatStream(sessionId, message, signal)` → engine `streamTurn` → `agent.runStream`. Late `StreamCancelled` handling server-side, no token burn after disconnect.
4. Config parity fixes (dead-end forwarding): `useReasoning` deleted end-to-end server-side (framework flag no longer exists); `auditRationale`, `skills.activate`, `budget`, `grounding`, `fabricationGuard`, `modelRouting`, `outputSchema` (decode string → object before persist) now forwarded; stale whitelists/allow-lists corrected (`blueprint`/`code-action`/`direct` added, `task-complete` removed, metaTools default corrected to explicit-true-not-silent, guardrail threshold inputs made honest boolean toggles, `memory.working` dropped, `fallbacks.errorThreshold` dropped).
5. Empty-assistant-turn fix on `StreamError` in the no-tools branch: optimistic user turn preserved, empty assistant turn removed, error surfaced as turn state.
6. Server-side StreamError also emits typed `StreamCancelled` when signal fires rather than a generic error (cancellation is not an error).
7. Tests: seeded-history resync from DB after cache eviction; recorded-once for tool turn (mid-early-close included); persona reaches direct path; tool-stream passthrough; config forwarding pins for every key in (4).

### Phase 3: chat UI (`chat-store.ts` + `ChatPanel.svelte` + `RunChatTab.svelte`)

1. Store reductions for `ToolCallStarted`/`ToolCallCompleted` (running → done per call id; rate of calls, failed calls red) rendering as live chips per turn.
2. `StreamCancelled`: distinct turn state, "stopped" badge, not error styling.
3. Stop button: `AbortSignal` wired through to fetch; stream genuinely detached after send. Plus regenerate-retry on failed turn.
4. Per-turn error decorator + retry affordance; keep-failed-vs-drop-empty logic matches server fix (no empty bubbles).
5. Live token/cost feed from stream metadata (chips exist already, wire the data).
6. Thought filtering: hide thoughts by toggle (`streamReasoningSteps`), keep tool chips visible. ChatGPT-shaped default.
7. Approval-pending gate: render pending approval request with the approve/deny affordance (framework `ApprovalRequested` event + existing `ApprovalPanel` patterns).
8. `RunChatTab` dedupe onto shared store reducer.
9. Tests: new store reductions for every new tag; the existing 8 SSE store tests updated for density/tool events.

### Phase 4: sync batch (small/medium, each independently shippable)

1. **`useReasoning` control removed from `AgentConfigPanel`** (UI half of the Phase 2 deletion; none left).
2. **config-parity → coverage guard:** assert every wither in `packages/runtime/src/builder.ts` is either wired in `build-cortex-agent.ts`, reachable via config overlay, or explicitly allow-listed as not-applicable-to-cortex. Same coverage assertion for chat-session config (chat keys covered where Phase 2 forwarded them). This is the structural fix for the drift class. Run last in this batch so it locks in the already-shipped work.
3. **Skill-lifecycle strip:** compact badge strip (same pattern as `VitalsStrip.svelte`) for `SkillActivated`/`SkillPromoted`/`SkillRefined`/`SkillRolledBack`/`SkillConflictDetected` in `RunDetail.svelte`.
4. **MCP OAuth 2.1 (0.17)**: auth block (client_credentials / private_key_jwt / authorization-code-note directing to `rax mcp login`) in the MCP server config form; wired through `mcp-config-import` → `build-cortex-agent` → `.withMCP({auth})`. No token-store changes in cortex (framework token store owns `$HOME/.reactive-agents/mcp-auth`).
5. **`withHarness()` advanced panel section:** Advanced-config UI section mapping the typed `HarnessConfig` fields that the framework honors (tool disclosure, tool discovery, tool index, verbose rules, context budgets), forwarded in builder overlay + runs/chat parity coverage. Display a non-wired-fields note for anything typed in the framework but not exposed so far (honest UI).
6. Tests: config coverage guard; MCP-auth forwarding; harness-config forwarding/round-trip.

### Phase 5: RAG (`withDocuments`) minimal ingestion

1. REST ingest route: POST documents (path-based list + file upload); parse/ingest through builder `.withDocuments(docs: DocumentSpec[])`; persist doc list per agent/session config.
2. Lab UI: document list + add/remove in `AgentConfigPanel` (compact form; document names + count exposed).
3. Wire through `runner-service.ts` for runs and `build-cortex-agent.ts` for chat runs.
4. Tests: config round-trip (UI → POST body → normalize → builder call captured); ingest route happy/sad path.
5. Explicitly out: deletion/re-ingesting, per-document status, progress polling, doc timeline UI. Documented in the decision doc as "future work".

### Phase 6: decision doc + gates

1. `wiki/Decisions/2026-10-25-cortex-production-withers-exclusion.md`: names the 10 excluded withers and why, lists the bandit selector + RAG doc management as deferred future work, and tells future drift audits to stop flagging them (audit-vs-decision cross-reference).
2. Update `wiki/Planning/Planning-Index.md` + design-spec index + AGENTS.md (cortex section summary: canonical engine, coverage guard, decision doc link).
3. Changesets: runtime minor (Phase 1), cortex patch/minor. Docs: README/debrief follow-up, no docs-site/API change besides the new `initialHistory` option (a run-time option that deserves a Starlight feature note).
4. Full gates: `bun test`, `bun run build`, `typecheck`, changeset, warden log entries.

---

## 4. Non-goals

- No new `AgentStreamEvent` grammar members, no new wire event format.
- No framework `SessionStoreService`-backed persistence for cortex DBs; cortex stays owner of its DB.
- No Jem app work; no docs-site overhaul of full descoped features (RAG doc management is deferred, bandit selector deferred, full production-hardening UI exposure deferred).
- No auth/multi-tenant changes to cortex API.
- No batching of engine/chrome code: `useReasoning` is deleted rather than deprecated, but all other key removals are one PR per key.
- No `docs/` writes; wiki is the single source of truth.

---

## 5. Risks and open items

- Engine recording change (Phase 1) touches a load-bearing chat primitive. Mitigation: full engine test suite + the new terminal-observation pins before warden report-out.
- Density "full" changes default stream volume; UI must default-hide thoughts so perceived payload does not balloon.
- MCP OAuth is guarded server-side by the framework (`stdio + auth` = error, etc.); cortex must surface the error (fail-fast in config validation, not a live-run crash). No silent no-op.
- `outputSchema` string-to-object decode is a persisted-data migration concern; decode on read is the chosen approach (sanity normalized at ingest time, no DB schema change).
- Cancel semantics: if request.signal is not stable in the server, fall back to a `.stop()` API path; change is contained in the route handler as decided. Flagged for review, not ratified beyond "signal threading preferred".
- The 0.16-era Memory v2 design and gateway changes are unrelated; not in scope. Watch the 0.17+ drift later on the coverage guard.
