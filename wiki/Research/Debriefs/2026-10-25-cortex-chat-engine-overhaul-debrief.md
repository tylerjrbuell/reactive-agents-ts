---
type: debrief
status: complete
created: 2026-10-25
related: "[[Implementation-Plans/2026-10-25-cortex-chat-engine-overhaul]]"
tags: [chat, cortex, engine, streaming, tool-calling, sync-backlog, rag, mcp-oauth, debrief]
---

# Cortex Chat Engine Overhaul + 0.17 Sync — Debrief

## Scope

`apps/cortex/**` (chat server, chat UI, config cascade, sync backlog items) + one warden-routed runtime change in `packages/runtime/src/**` (initialHistory + streamTurn recording). **Commits:** `0d5549ffa` (runtime) through `65877fab6` (mcp auth). **Spec:** `wiki/Architecture/Design-Specs/2026-10-25-cortex-chat-engine-overhaul-spec.md` (status: implemented). **Plan:** `wiki/Planning/Implementation-Plans/2026-10-25-cortex-chat-engine-overhaul.md` (status: completed).

## What was done

### Phase 1 — runtime (warden)
- `ChatEngineOptions.initialHistory` + `SessionOptions.initialHistory` + pass-through in `ReactiveAgent.session()`. Engine seeds once at construction and latches `#loaded` so `loadHistory` never runs when a seed is supplied.
- `streamTurn` records/publishes/persists when the `StreamCompleted` event is OBSERVED inside the tee loop (before yield), guarded by a `recorded` flag, so a consumer closing on `StreamCompleted` cannot drop the turn. `StreamError`/early-abort still records nothing.

### Phase 2 — cortex chat server
- `buildSession` now builds an engine-backed session: `agent.session({ persist: false, id: cortexSessionId, initialHistory })`, agent always `.withStreaming()`. Legacy `chatFn`/`new AgentSession(...)` construction deleted from cortex.
- `chat()` + both SSE branches share one cached session. Tools/steps path streams `density: "full"` through `session.runStream()`; no-tools/no-steps keeps the cheap direct `session.chat()` path.
- Cancel: `request.signal` threaded `chatStream` → engine `streamTurn` → `agent.runStream`; abort maps to a yielded `StreamCancelled` (not an error); no DB assistant turn on cancel.
- Empty-assistant-turn fix on `StreamError` (no empty bubbles).
- Config parity: `buildChatAgentParams` now forwards `auditRationale`, `skills.activate`, `budget`, `grounding`, `fabricationGuard`, `modelRouting`, `outputSchema` (string→object decode), `harness`, `documents`. `useReasoning` deleted end-to-end (framework flag confirmed dead post-v0.16): API bodies, runner-service, gateway-process-manager, cortex-to-agent-config, cortex-agent-config normalize, BuildCortexAgentParams, UI type, AgentConfigPanel toggle, post-body, tests.
- Strategy whitelist now includes `blueprint`/`code-action`/`direct`; metaTools default corrected; guardrail thresholds made honest booleans.

### Phase 3 — cortex UI
- Store: `ToolCallStarted`/`ToolCallCompleted` → live chips (running → done/failed); `StreamCancelled` → cancelled badge; `stop()` via module-level AbortController threaded into `connectRunStream`; thought filtering by `streamReasoningSteps` toggle; live chip render in ChatPanel.
- ChatPanel: live tool chips, stop button (replaces send while sending), stopped badge, retry on error, thought filtering.
- RunChatTab: tool/cancelled handling added.

### Phase 4 — sync batch
- `useReasoning` UI removal (5 files).
- Config-parity **coverage guard** (`config-parity.test.ts`): every wither in `builder.ts` must be in WIRED / OVERLAY_REACHABLE / NOT_APPLICABLE; `chat-runs-config-drift` extended for chat keys.
- Skill-lifecycle badge strip in run view (`SkillStrip.svelte`).
- MCP OAuth 2.1 auth config in ToolWorkshop + `parseConfigBody` forwarding + stdio+auth rejection.
- `withHarness()` advanced control surface (UI JSON textarea + builder overlay).
- Production-withers exclusion decision doc (`wiki/Decisions/2026-10-25-cortex-production-withers-exclusion.md`).

### Phase 5 — RAG minimal ingestion
- `documents` field through BuildCortexAgentParams, LaunchParams, gateway-process-manager, api bodies, chat parity, normalize, UI type + post-body + AgentConfigPanel textarea. `.withDocuments()` overlay.

### Phase 6 — gates + docs
- Changeset (runtime minor + cortex minor), wiki index updates, Hot.md entry.

## Known issues / NOT fixed (handoff)

1. **Cortex "not working correctly and has bad performance" (user-reported, 2026-10-25).** Not investigated this session per user instruction. Suspected areas for the next agent:
   - Cached agent is disposed only on eviction/config-update/delete; MCP containers now live for the whole session (may leak or hold resources) — previously disposed per turn.
   - Tools/steps path always streams `density: "full"`; UI filters thoughts but server still emits them → larger payloads.
   - Store reducer handles rapid tool events; untested at scale; potential re-render thrash.
   - `updateSessionConfig` evicts + rebuilds; history resync from DB relies on `initialHistory` (added this session) — verify no double-recording edge.
   - Performance of `normalizeCortexAgentConfig` + `buildChatAgentParams` on every turn (called in `chat()` and `chatStream`).
2. **Stale-dist trap:** `bun rax cortex` loads `apps/cortex/dist/index.js`. Must run `bun run build:apps` (or `bun run build` in `apps/cortex`) after source edits. Dev mode (`bun start`) avoids this. This caused the "new chat session doesn't show up" report; resolved by rebuild, not a code fix.
3. **Task 10 partial:** RunChatTab got tool/cancelled handling but still has its own SSE loop (not fully deduped onto the store reducer).
4. **MCP OAuth interactive flow** not implemented in UI (only config); user must run `rax mcp login` for authorization_code.
5. **RAG doc management** (delete/re-ingest, status, progress, timeline) deferred — minimal ingestion only.

## Verification state at handoff

- `bun test apps/cortex/server/tests`: 330 pass / 0 fail
- `cd apps/cortex/ui && bun test src/lib`: 121 pass / 0 fail
- `bun test packages/runtime/tests/chat`: 77 pass / 0 fail
- `bun test packages/runtime/tests/subagent/dispatch-logging.test.ts`: 1 pass / 0 fail
- `bun run typecheck`: 69/69 clean
- `bun run build:packages`: 34/34 clean; `bun run build:apps`: 35/35 clean

## How to run

- From source: `cd apps/cortex && bun start` (UI 5173, API 4321).
- Via CLI: `bun rax cortex` (requires rebuilt dist: `bun run build:apps`).
- Tests: `bun test apps/cortex/server/tests/<file>.ts --timeout 15000`; UI: `cd apps/cortex/ui && bun test src/lib --timeout 15000`.

## Key files for the next agent

- `apps/cortex/server/services/chat-session-service.ts` — chat() (143), chatStream (184), buildSession, buildChatAgentParams (333)
- `apps/cortex/server/api/chat.ts` — SSE route (288), config schema (5)
- `apps/cortex/ui/src/lib/stores/chat-store.ts` — sendMessageStream, stop, tool reductions
- `apps/cortex/ui/src/lib/components/ChatPanel.svelte` — render (chips, stop, retry, cancelled)
- `apps/cortex/server/services/build-cortex-agent.ts` — builder overlay (withers wiring)
- `apps/cortex/server/services/cortex-agent-config.ts` — normalizeCortexAgentConfig
- `packages/runtime/src/chat/engine.ts` — ChatEngine (initialHistory, streamTurn recording)

## Entry points for the pending performance work

Start with the cached-agent lifecycle and the `density: "full"` default in `chatStream` (tools/steps branch). Measure before changing; the user explicitly asked not to attempt fixes this session.